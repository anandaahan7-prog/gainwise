// Builds a GainWise model from a tiny hand-written portfolio, the same way the app does after the
// Python engine has run. Dates are relative to today so tests keep their meaning as time passes.
import { buildModel } from '../src/lib/portfolio';
import { resolveClasses } from '../src/lib/classify';
import { addDays, addMonths, todayISO } from '../src/lib/dates';

export const today = todayISO();
export const daysAgo = (n) => addDays(today, -n);
export const monthsAgo = (n) => addMonths(today, -n);

/**
 * funds: { name: { cls, nav, category?, lots: [{ buyDate, units, buyNav }] } }
 * sales: realized matches [{ fund, buyDate, sellDate, units, buyNav, sellNav }]
 */
export function makeModel({ funds, sales = [], sims = [], slab = 0.3, bfLosses = {} }) {
  const raw = {
    funds: Object.fromEntries(Object.entries(funds).map(([name, f]) => [name, { heuristic: f.cls ?? 'Unknown', keyword: null }])),
    holdings: Object.entries(funds).flatMap(([fund, f]) => (f.lots ?? []).map((l) => ({ fund, ...l }))),
    matches: sales.map((s, i) => ({ sellId: `${s.fund}#${i}`, cost: s.units * s.buyNav, proceeds: s.units * s.sellNav, ...s })),
    transactions: [],
    warnings: [],
    stats: { rows: 0 },
  };
  const navs = Object.fromEntries(
    Object.entries(funds).filter(([, f]) => f.nav).map(([name, f]) => [name, { nav: f.nav, navDate: today, category: f.category, source: 'live' }]),
  );
  const classes = resolveClasses(raw.funds, {}, navs);
  return buildModel({ raw, classes, navs, sims, slab, bfLosses });
}
