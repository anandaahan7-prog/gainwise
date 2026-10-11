// Resolves each fund's tax class: manual override > AMFI category > name heuristic (from Python).

// Map an AMFI scheme category ("Equity Scheme - Large Cap Fund") to a tax class.
export function classFromAmfi(category, heuristic) {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.startsWith('equity scheme')) return 'Equity';
  if (c.startsWith('debt scheme')) return 'Debt';
  if (c.startsWith('hybrid scheme')) {
    if (/arbitrage|aggressive|equity savings|balanced advantage|dynamic asset/.test(c)) return 'Equity';
    if (/conservative/.test(c)) return 'Debt';
    return 'Other';
  }
  if (/gold|silver|overseas|fof|fund of fund/.test(c)) return 'Other';
  // Index funds, ETFs and solution-oriented funds: the category alone doesn't say what they hold
  if (heuristic && heuristic !== 'Unknown') return heuristic;
  if (/index|etf/.test(c)) return 'Equity';
  return null;
}

export function resolveClasses(funds, overrides, navs) {
  const out = {};
  for (const [name, info] of Object.entries(funds)) {
    const amfi = classFromAmfi(navs[name]?.category, info.heuristic);
    if (overrides[name]) out[name] = { cls: overrides[name], source: 'manual' };
    else if (amfi) out[name] = { cls: amfi, source: 'amfi', detail: navs[name].category };
    else out[name] = { cls: info.heuristic, source: 'heuristic', detail: info.keyword };
  }
  return out;
}
