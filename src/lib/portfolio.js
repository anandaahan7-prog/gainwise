import { enrich, treatment, computeTax, grandfatheredNav, GRANDFATHER_CUTOFF } from './tax';
import { fyOf, daysBetween, todayISO } from './dates';

const byFundThenDate = (a, b) => a.fund.localeCompare(b.fund) || a.buyDate.localeCompare(b.buyDate);

/**
 * FIFO-sell open lots in JS (used for what-if sales; the real history is matched in Python).
 * sales: [{ id, fund, units, nav, date }] applied in order.
 */
export function applySales(holdings, sales) {
  const lots = holdings.map((h) => ({ ...h })).sort(byFundThenDate);
  const matches = [];
  for (const sale of sales) {
    let remaining = sale.units;
    for (const lot of lots) {
      if (remaining <= 1e-9) break;
      if (lot.fund !== sale.fund || lot.units <= 1e-9) continue;
      const take = Math.min(remaining, lot.units);
      matches.push({
        fund: sale.fund,
        sellId: sale.id,
        sellDate: sale.date,
        buyDate: lot.buyDate,
        units: take,
        buyNav: lot.buyNav,
        sellNav: sale.nav,
        cost: take * lot.buyNav,
        proceeds: take * sale.nav,
        simulated: true,
      });
      lot.units -= take;
      remaining -= take;
    }
  }
  return { matches, holdings: lots.filter((l) => l.units > 1e-9) };
}

// Everything the screens need, derived from the engine output + user choices
export function buildModel({ raw, classes, navs, sims, slab }) {
  const today = todayISO();
  const currentFy = fyOf(today);
  const clsOf = (fund) => classes[fund]?.cls ?? 'Unknown';
  const fmvOf = (fund) => navs[fund]?.fmv2018 ?? null;
  const enrichMatch = (m) => enrich(m, clsOf(m.fund), fmvOf(m.fund));

  const realized = raw.matches.map(enrichMatch);
  const sim = applySales(raw.holdings, sims);
  const simulated = sim.matches.map(enrichMatch);

  const fySet = new Set(realized.map((r) => r.fy));
  fySet.add(currentFy);
  const fys = [...fySet].sort((a, b) => b - a);

  const recordsFor = (fy, { withSims = true } = {}) => [
    ...realized.filter((r) => r.fy === fy),
    ...(withSims && fy === currentFy ? simulated : []),
  ];
  const taxFor = (fy, opts) => computeTax(recordsFor(fy, opts), fy, slab);

  const lots = sim.holdings.map((lot) => {
    const cls = clsOf(lot.fund);
    const nav = navs[lot.fund]?.nav ?? null;
    const t = treatment(cls, lot.buyDate, today);
    const cost = lot.units * lot.buyNav;
    const value = nav != null ? lot.units * nav : null;
    // Per-unit cost the taxman would use if this lot were sold today (grandfathered for pre-2018 equity)
    const fmv = cls === 'Equity' && lot.buyDate < GRANDFATHER_CUTOFF ? fmvOf(lot.fund) : null;
    const basisNav = fmv && nav != null ? grandfatheredNav(lot.buyNav, fmv, nav) : lot.buyNav;
    return {
      ...lot,
      fmv2018: fmv,
      basisNav,
      assetClass: cls,
      cost,
      nav,
      value,
      gain: value != null ? value - cost : null,
      term: t.term,
      head: t.head,
      ltFrom: t.term === 'ST' ? t.ltFrom : null,
      daysToLt: t.term === 'ST' && t.ltFrom ? daysBetween(today, t.ltFrom) : null,
      deemed: t.deemed,
      ageDays: daysBetween(lot.buyDate, today),
    };
  });

  const fundNames = Object.keys(raw.funds).sort();
  const funds = fundNames.map((name) => {
    const fundLots = lots.filter((l) => l.fund === name);
    const sum = (k) => fundLots.reduce((a, l) => a + (l[k] ?? 0), 0);
    const hasNav = navs[name]?.nav != null;
    return {
      name,
      assetClass: clsOf(name),
      classSource: classes[name]?.source,
      classDetail: classes[name]?.detail,
      lots: fundLots,
      units: sum('units'),
      cost: sum('cost'),
      value: hasNav ? sum('value') : null,
      gain: hasNav ? sum('gain') : null,
      ltUnits: fundLots.filter((l) => l.term === 'LT').reduce((a, l) => a + l.units, 0),
      nextLt: fundLots.filter((l) => l.ltFrom).sort((a, b) => a.ltFrom.localeCompare(b.ltFrom))[0]?.ltFrom ?? null,
      nav: navs[name] ?? null,
      realizedGain: realized.filter((r) => r.fund === name).reduce((a, r) => a + r.gain, 0),
    };
  });

  // Funds that need the 31 Jan 2018 FMV: equity units bought before 1 Feb 2018, sold or still held
  const needsFmv = [...new Set([...raw.matches, ...raw.holdings].filter((x) => x.buyDate < GRANDFATHER_CUTOFF).map((x) => x.fund))]
    .filter((f) => clsOf(f) === 'Equity');

  return { today, currentFy, realized, simulated, fys, recordsFor, taxFor, lots, funds, slab, clsOf, enrichMatch, needsFmv, transactions: raw.transactions };
}

// Group lot-level records into one row per sell transaction (for tables)
export function groupSales(records) {
  const map = new Map();
  for (const r of records) {
    let row = map.get(r.sellId);
    if (!row) {
      row = { id: r.sellId, fund: r.fund, sellDate: r.sellDate, assetClass: r.assetClass, units: 0, cost: 0, proceeds: 0, st: 0, lt: 0, lots: [], simulated: !!r.simulated };
      map.set(r.sellId, row);
    }
    row.units += r.units;
    row.cost += r.cost;
    row.proceeds += r.proceeds;
    if (r.term === 'ST') row.st += r.gain;
    else row.lt += r.gain;
    row.lots.push(r);
  }
  return [...map.values()].sort((a, b) => b.sellDate.localeCompare(a.sellDate));
}
