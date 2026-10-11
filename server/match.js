// Matches broker fund names ("ICICI Prudential Large Cap Fund Direct Growth") to AMFI scheme codes.
// Builds an inverted token index over every scheme so a lookup only scores plausible candidates.

const STOP = new Set(['fund', 'plan', 'option', 'the', 'scheme', 'of', 'mutual', 'mf']);
const PLAN_WORDS = new Set(['direct', 'regular', 'growth']);
const BAD_OPTION = /idcw|dividend|bonus|payout|reinvest|institutional|retail|premium|weekly|daily|monthly|quarterly|annual/i;

export const tokenize = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '') // "Children's" and "Childrens" must tokenize the same
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));

export function buildIndex(schemes) {
  const entries = schemes.map((s) => {
    const nameTokens = tokenize(s.name).filter((t) => !PLAN_WORDS.has(t));
    // NAVAll often leaves plan/option blank; the scheme master's NAV name always carries them
    const planText = `${s.plan ?? ''} ${s.option ?? ''} ${s.nav_name ?? s.name}`.toLowerCase();
    return {
      scheme: s,
      nameTokens: new Set(nameTokens),
      direct: /direct/.test(planText),
      growth: /growth/.test(planText),
      badOption: BAD_OPTION.test(`${s.option ?? ''} ${s.nav_name ?? s.name}`),
    };
  });
  const postings = new Map();
  entries.forEach((e, i) => {
    for (const t of e.nameTokens) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(i);
    }
  });
  return { entries, postings };
}

function score(query, e) {
  let s = 0;
  for (const t of query.tokens) if (e.nameTokens.has(t)) s += 2;
  for (const t of e.nameTokens) if (!query.tokenSet.has(t)) s -= 1;
  if (query.tokens[0] && e.nameTokens.has(query.tokens[0])) s += 2; // AMC name usually leads
  if (query.direct !== e.direct) s -= 6;
  if (e.badOption) s -= 8;
  if (e.growth) s += 2;
  if (!e.scheme.nav) s -= 3; // wound-up / matured schemes have no current NAV
  return s;
}

export function matchName(index, name, { limit = 3 } = {}) {
  const lower = name.toLowerCase();
  const tokens = tokenize(name).filter((t) => !PLAN_WORDS.has(t));
  if (!tokens.length) return { best: null, alternatives: [] };
  const query = { tokens, tokenSet: new Set(tokens), direct: /direct/.test(lower) };
  // Candidate set: schemes sharing at least one reasonably specific token
  const candidates = new Set();
  for (const t of tokens) {
    const list = index.postings.get(t);
    if (list && list.length < 3000) list.forEach((i) => candidates.add(i));
  }
  const ranked = [...candidates]
    .map((i) => ({ e: index.entries[i], s: score(query, index.entries[i]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  const out = ranked.map(({ e, s }) => ({ ...publicScheme(e.scheme), score: s }));
  return { best: out[0] && out[0].score > 0 ? out[0] : null, alternatives: out };
}

export const fullName = (s) => (s.plan || s.option || !s.nav_name ? [s.name, s.plan, s.option].filter(Boolean).join(' - ') : s.nav_name);

export const publicScheme = (s) => ({
  code: s.code,
  name: fullName(s),
  amc: s.amc,
  category: s.category,
  isin: s.isin_growth || s.isin_reinv || null,
  nav: s.nav,
  navDate: s.nav_date,
});
