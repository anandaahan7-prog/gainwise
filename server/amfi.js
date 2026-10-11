// Fetches and parses AMFI's public NAV files.
//   NAVAll.txt              – latest NAV of every scheme, refreshed by AMFI through the day
//   NAV history for a date  – every scheme's NAV on one date (used for the 31 Jan 2018 grandfathering FMV)
//   mfapi.in /mf/:code      – full NAV history of one scheme (fallback for arbitrary dates)

const NAV_ALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const HISTORY_URL = (d) => `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${d}`;
const MFAPI_URL = (code) => `https://api.mfapi.in/mf/${code}`;
const SCHEME_MASTER_URL = 'https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0';

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const MONTH_NAMES = Object.keys(MONTHS).map((m) => m[0].toUpperCase() + m.slice(1));

// "09-Oct-2026" -> "2026-10-09"
export function amfiDateToIso(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null;
}

// "2018-01-31" -> "31-Jan-2018"
export const isoToAmfiDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTH_NAMES[Number(m) - 1]}-${y}`;
};

const num = (s) => {
  const v = parseFloat(s);
  return Number.isFinite(v) && v > 0 ? v : null;
};
const clean = (s) => (s && s !== '-' ? s.trim() : null);

/** Parse NAVAll.txt into scheme rows (category comes from the section heading above each block). */
export function parseNavAll(text, now = new Date().toISOString()) {
  const rows = [];
  let category = null;
  let amc = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Scheme Code')) continue;
    if (!line.includes(';')) {
      const heading = /schemes?\s*\((.+)\)\s*$/i.exec(line);
      if (heading) category = heading[1].trim();
      else amc = line;
      continue;
    }
    const f = line.split(';');
    const code = parseInt(f[0], 10);
    if (!Number.isFinite(code)) continue;
    // Current format: code;isinG;isinR;name;plan;option;nav;date  (older: code;isinG;isinR;name;nav;date)
    const wide = f.length >= 8;
    const name = f[3]?.trim();
    if (!name) continue;
    rows.push({
      code,
      name,
      amc,
      category,
      plan: wide ? clean(f[4]) : null,
      option: wide ? clean(f[5]) : null,
      isin_growth: clean(f[1]),
      isin_reinv: clean(f[2]),
      nav: num(wide ? f[6] : f[4]),
      nav_date: amfiDateToIso(wide ? f[7] : f[5]),
      updated_at: now,
    });
  }
  return rows;
}

/** Parse AMFI's NAV-history report: code;name;plan;option;isinG;isinR;nav;date */
export function parseHistoryReport(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(';');
    if (f.length < 8) continue;
    const code = parseInt(f[0], 10);
    const nav = num(f[6]);
    const date = amfiDateToIso(f[7]);
    if (Number.isFinite(code) && nav && date) rows.push({ code, date, nav });
  }
  return rows;
}

// Minimal RFC 4180 CSV parser (quoted fields may contain commas, quotes and newlines)
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** AMFI scheme master: every scheme's full NAV name ("X Fund - Direct Plan - Growth") and category. */
export async function fetchSchemeMaster() {
  const res = await fetch(SCHEME_MASTER_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`AMFI scheme master returned HTTP ${res.status}`);
  const [header, ...rows] = parseCsv(await res.text());
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iCode = col('code');
  const iNavName = col('scheme nav name');
  const iCategory = col('scheme category');
  if (iCode < 0 || iNavName < 0) throw new Error('Unexpected scheme master format');
  return rows
    .map((r) => ({ code: parseInt(r[iCode], 10), navName: r[iNavName]?.trim(), category: r[iCategory]?.trim() || null }))
    .filter((r) => Number.isFinite(r.code) && r.navName);
}

/** Conditional GET of NAVAll.txt. Returns { notModified } or { rows, etag, lastModified }. */
export async function fetchNavAll({ etag, lastModified } = {}) {
  const headers = { 'User-Agent': 'GainWise-NAV-cache/1.0' };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const res = await fetch(NAV_ALL_URL, { headers, signal: AbortSignal.timeout(60_000) });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`AMFI NAVAll returned HTTP ${res.status}`);
  const text = await res.text();
  return { rows: parseNavAll(text), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
}

export async function fetchNavsOnDate(iso) {
  const res = await fetch(HISTORY_URL(isoToAmfiDate(iso)), { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`AMFI history returned HTTP ${res.status}`);
  return parseHistoryReport(await res.text());
}

/** Full history for one scheme from mfapi.in: [{ code, date, nav }] */
export async function fetchSchemeHistory(code) {
  const res = await fetch(MFAPI_URL(code), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`mfapi returned HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? [])
    .map((r) => {
      const [d, m, y] = r.date.split('-');
      return { code, date: `${y}-${m}-${d}`, nav: num(r.nav) };
    })
    .filter((r) => r.nav);
}
