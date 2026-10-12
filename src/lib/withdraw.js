// "I need ₹X by a date": choose which units to redeem so the extra tax is as small as possible.
//
// Units leave each fund oldest-first (FIFO), so a plan is just "how many rupees to take from each
// fund". Tax is piecewise-linear in those amounts but not separable (exemption, loss set-off), so:
//   1. look-ahead greedy: repeatedly add the cheapest chunk (any number of a fund's next lots,
//      so a costly lot that hides a loss-making lot behind it is still found);
//   2. pairwise refinement: for every pair of funds, re-split their combined amount by searching
//      lot boundaries and a grid, then zooming in around the best point;
//   3. never return anything worse than taking the same share from every fund.
// Every candidate is priced by the full tax engine. The test suite checks it against brute force.
import { applySales } from './portfolio';
import { fyOf } from './dates';

const ceil3 = (v) => Math.ceil(v * 1000 - 1e-6) / 1000;

function sellableLots(fund) {
  const lots = [];
  for (const l of fund.lots) {
    if (l.locked) break; // FIFO can't skip past a locked ELSS lot
    lots.push(l);
  }
  return lots;
}

export function planWithdrawal(model, amount, { date = model.today } = {}) {
  const fy = fyOf(date);
  const base = model.recordsFor(fy);
  const baseTax = model.computeTaxFor(base, fy).total;

  const funds = model.funds
    .filter((f) => f.nav?.nav && f.sellableUnits > 1e-6)
    .map((f) => {
      const lots = sellableLots(f);
      const nav = f.nav.nav;
      // Cumulative rupee value at each lot boundary (where the tax rate can change)
      const bounds = [];
      lots.reduce((acc, l) => {
        const next = acc + l.units * nav;
        bounds.push(next);
        return next;
      }, 0);
      return { name: f.name, nav, cap: bounds[bounds.length - 1] ?? 0, bounds };
    });
  const available = funds.reduce((a, f) => a + f.cap, 0);
  const target = Math.min(amount, available);

  const cache = new Map();
  const taxOf = (x) => {
    const key = x.map((v) => v.toFixed(2)).join('|');
    if (cache.has(key)) return cache.get(key);
    const sales = [];
    x.forEach((v, i) => v > 0.005 && sales.push({ id: `w${i}`, fund: funds[i].name, units: v / funds[i].nav, nav: funds[i].nav, date }));
    let t = baseTax;
    if (sales.length) {
      const { matches } = applySales(model.lots, sales);
      t = model.computeTaxFor([...base, ...matches.map(model.enrichMatch)], fy).total;
    }
    cache.set(key, t);
    return t;
  };

  // 1. Look-ahead greedy
  let x = funds.map(() => 0);
  let raised = 0;
  let tax = baseTax;
  while (raised < target - 0.5) {
    let best = null;
    funds.forEach((f, i) => {
      const ends = [...f.bounds.filter((b) => b > x[i] + 0.005), f.cap];
      for (const end of ends) {
        const take = Math.min(end - x[i], target - raised);
        if (take <= 0.005) continue;
        const trial = x.slice();
        trial[i] += take;
        const t = taxOf(trial);
        const rate = (t - tax) / take;
        if (!best || rate < best.rate - 1e-9 || (Math.abs(rate - best.rate) <= 1e-9 && take > best.take)) best = { i, take, t, rate };
        if (take >= target - raised) break; // later ends can't add more
      }
    });
    if (!best) break;
    x[best.i] += best.take;
    raised += best.take;
    tax = best.t;
  }

  // 2. Pairwise refinement: move money between two funds while keeping their total fixed
  const refinePair = (i, j) => {
    const total = x[i] + x[j];
    const lo = Math.max(0, total - funds[j].cap);
    const hi = Math.min(total, funds[i].cap);
    if (hi - lo < 1) return false;
    const evalAt = (v) => {
      const trial = x.slice();
      trial[i] = v;
      trial[j] = total - v;
      return taxOf(trial);
    };
    const pts = new Set([lo, hi, x[i]]);
    for (let k = 1; k < 40; k++) pts.add(lo + ((hi - lo) * k) / 40);
    funds[i].bounds.forEach((b) => b > lo && b < hi && pts.add(b));
    funds[j].bounds.forEach((b) => total - b > lo && total - b < hi && pts.add(total - b));
    let sorted = [...pts].sort((a, b) => a - b);
    let bestV = x[i];
    let bestT = evalAt(bestV);
    for (let round = 0; round < 3; round++) {
      for (const v of sorted) {
        const t = evalAt(v);
        if (t < bestT - 0.01) {
          bestT = t;
          bestV = v;
        }
      }
      // zoom in between the neighbours of the best point
      const idx = sorted.findIndex((v) => v >= bestV);
      const a = sorted[Math.max(0, idx - 1)];
      const b = sorted[Math.min(sorted.length - 1, idx + 1)];
      sorted = Array.from({ length: 21 }, (_, k) => a + ((b - a) * k) / 20);
    }
    if (Math.abs(bestV - x[i]) > 0.005 && bestT < evalAt(x[i]) - 0.01) {
      x[j] = total - bestV;
      x[i] = bestV;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < funds.length; i++) {
      for (let j = 0; j < funds.length; j++) {
        if (i !== j && x[i] > 0.005 && refinePair(i, j)) improved = true;
      }
    }
    if (!improved) break;
  }

  // 3. Same share from every fund, as a floor and as the comparison shown to the user
  const share = target / Math.max(available, 1);
  const proportional = funds.map((f) => f.cap * share);
  const baselineTax = available > 0 ? taxOf(proportional) : baseTax;
  if (baselineTax < taxOf(x) - 0.01) x = proportional;

  const sales = x
    .map((v, i) => ({ fund: funds[i].name, nav: funds[i].nav, units: Math.min(ceil3(v / funds[i].nav), funds[i].cap / funds[i].nav) }))
    .filter((s) => s.units > 0.0005)
    .map((s) => ({ ...s, value: s.units * s.nav }))
    .sort((a, b) => b.value - a.value);
  const raisedFinal = sales.reduce((a, s) => a + s.value, 0);

  return {
    fy,
    date,
    amount,
    raised: raisedFinal,
    shortfall: Math.max(0, amount - raisedFinal),
    available,
    sales,
    extraTax: taxOf(x) - baseTax,
    baselineExtraTax: baselineTax - baseTax,
  };
}
