// Live NAVs. Preferred source is the GainWise NAV server (server/, an AMFI mirror); when it isn't
// reachable (e.g. a static-only deploy) we fall back to mfapi.in directly. Either way only fund
// *names* and scheme codes are sent — never units, amounts, dates or anything else from the file.
import { todayISO } from './dates';

const API = 'https://api.mfapi.in/mf';
const SERVER = import.meta.env.VITE_API_URL ?? '/api';

const tokens = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['fund', 'plan', 'option', 'the', 'scheme'].includes(t));

function score(fundName, candidate) {
  const want = new Set(tokens(fundName));
  const have = tokens(candidate);
  const haveSet = new Set(have);
  let s = 0;
  for (const t of want) if (haveSet.has(t)) s += 2;
  for (const t of haveSet) if (!want.has(t)) s -= 1;
  const c = candidate.toLowerCase();
  const isDirect = /direct/.test(fundName.toLowerCase());
  if (isDirect !== /direct/.test(c)) s -= 6;
  if (/idcw|dividend|bonus|payout|reinvest|institutional|retail|premium/.test(c)) s -= 8;
  if (/growth/.test(c)) s += 2;
  return s;
}

async function search(q) {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json();
}

export async function findScheme(fundName) {
  const core = fundName.replace(/\b(direct|regular)\b|\bgrowth\b|\bplan\b|\boption\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let results = await search(fundName);
  if (!results.length) results = await search(core);
  if (!results.length) return null;
  const best = results
    .map((r) => ({ ...r, score: score(fundName, r.schemeName) }))
    .sort((a, b) => b.score - a.score)[0];
  return best.score > 0 ? { schemeCode: best.schemeCode, schemeName: best.schemeName } : null;
}

export async function latestNav(schemeCode) {
  const res = await fetch(`${API}/${schemeCode}/latest`);
  if (!res.ok) throw new Error(`NAV lookup failed (${res.status})`);
  const json = await res.json();
  const row = json.data?.[0];
  if (!row) throw new Error('No NAV published');
  const [d, m, y] = row.date.split('-');
  return {
    nav: parseFloat(row.nav),
    navDate: `${y}-${m}-${d}`,
    schemeCode: json.meta.scheme_code,
    schemeName: json.meta.scheme_name,
    category: json.meta.scheme_category,
    isin: json.meta.isin_growth || json.meta.isin_div_reinvestment || '',
    source: 'live',
    fetchedOn: todayISO(),
  };
}

// ---------------------------------------------------------------------------
// GainWise server
// ---------------------------------------------------------------------------
class ServerUnavailable extends Error {}

async function serverPost(path, body) {
  let res;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ServerUnavailable(e.message);
  }
  // A static host without the API answers 404/405 (or serves index.html); treat as "no server"
  const json = /json/.test(res.headers.get('content-type') ?? '') ? await res.json() : null;
  if (!json || res.status === 404 || res.status === 405 || res.status >= 502) throw new ServerUnavailable(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const fromServer = (s) => ({
  nav: s.nav,
  navDate: s.navDate,
  schemeCode: s.code,
  schemeName: s.name,
  category: s.category,
  isin: s.isin || '',
  source: 'live',
  via: 'server',
  fetchedOn: todayISO(),
});

async function fetchNavsFromServer(fundNames, known) {
  const results = {};
  const errors = {};
  const codes = { ...Object.fromEntries(fundNames.filter((n) => known[n]).map((n) => [n, Number(known[n])])) };
  const unknown = fundNames.filter((n) => !codes[n]);
  for (let i = 0; i < unknown.length; i += 50) {
    const { results: matched } = await serverPost('/match', { names: unknown.slice(i, i + 50) });
    for (const [name, m] of Object.entries(matched)) {
      if (m.best) codes[name] = m.best.code;
      else errors[name] = 'No matching scheme found';
    }
  }
  const list = [...new Set(Object.values(codes))];
  const navs = {};
  for (let i = 0; i < list.length; i += 100) Object.assign(navs, (await serverPost('/navs', { codes: list.slice(i, i + 100) })).navs);
  for (const [name, code] of Object.entries(codes)) {
    const s = navs[code];
    if (s?.nav) results[name] = fromServer(s);
    else errors[name] = s ? 'Scheme has no current NAV' : 'Unknown scheme code';
  }
  return { results, errors };
}

// ---------------------------------------------------------------------------
// Direct mfapi.in fallback
// ---------------------------------------------------------------------------
async function fetchNavsFromMfapi(fundNames, known, onProgress) {
  const results = {};
  const errors = {};
  let done = 0;
  const queue = [...fundNames];
  const workerFn = async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        const code = known[name] || (await findScheme(name))?.schemeCode;
        if (!code) throw new Error('No matching scheme found');
        results[name] = { ...(await latestNav(code)), via: 'mfapi' };
      } catch (e) {
        errors[name] = e.message;
      }
      done += 1;
      onProgress?.(done, fundNames.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, fundNames.length) }, workerFn));
  return { results, errors };
}

/**
 * Latest NAVs for many funds. `known` maps fund -> schemeCode (a previous match or a manual
 * correction) so we skip name matching. Returns { results, errors, via: 'server' | 'mfapi' }.
 */
export async function fetchNavs(fundNames, known, onProgress) {
  try {
    const out = await fetchNavsFromServer(fundNames, known);
    onProgress?.(fundNames.length, fundNames.length);
    return { ...out, via: 'server' };
  } catch (e) {
    if (!(e instanceof ServerUnavailable)) throw e;
    return { ...(await fetchNavsFromMfapi(fundNames, known, onProgress)), via: 'mfapi' };
  }
}

/** NAV per unit on 31 Jan 2018 (Sec 112A grandfathering FMV) for each scheme code. */
export async function fetchFmv2018(codes) {
  if (!codes.length) return {};
  try {
    const { fmv } = await serverPost('/fmv2018', { codes });
    return Object.fromEntries(Object.entries(fmv).filter(([, v]) => v).map(([c, v]) => [c, v.nav]));
  } catch (e) {
    if (!(e instanceof ServerUnavailable)) throw e;
  }
  // Fallback: each scheme's full history from mfapi.in, take the last NAV on/before 31 Jan 2018
  const out = {};
  await Promise.all(codes.map(async (code) => {
    try {
      const json = await (await fetch(`${API}/${code}`)).json();
      const row = json.data?.find((r) => {
        const [d, m, y] = r.date.split('-');
        const iso = `${y}-${m}-${d}`;
        return iso <= '2018-01-31' && iso >= '2018-01-24';
      });
      if (row) out[code] = parseFloat(row.nav);
    } catch {
      /* leave this scheme without an FMV */
    }
  }));
  return out;
}
