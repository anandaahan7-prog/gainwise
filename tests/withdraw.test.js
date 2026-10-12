import { describe, expect, it } from 'vitest';
import { planWithdrawal } from '../src/lib/withdraw';
import { applySales } from '../src/lib/portfolio';
import { makeModel, monthsAgo } from './helpers';

// Deterministic pseudo-random numbers so failures are reproducible
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function randomPortfolio(seed) {
  const r = rng(seed);
  const fund = (name, cls) => {
    const nav = 50 + Math.round(r() * 150);
    const lots = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({
      buyDate: monthsAgo(40 - i * 12 - Math.floor(r() * 8)),
      units: 200 + Math.round(r() * 800),
      buyNav: Math.round(nav * (0.55 + r() * 0.8)),
    }));
    return [name, { cls, nav, lots }];
  };
  const realized = r() < 0.5 ? [] : [{ fund: 'Booked Fund', buyDate: monthsAgo(8), sellDate: monthsAgo(0), units: 1000, buyNav: 100, sellNav: 100 + Math.round(r() * 80) }];
  return {
    funds: Object.fromEntries([fund('Alpha Equity Fund', 'Equity'), fund(r() < 0.5 ? 'Beta Equity Fund' : 'Beta Bond Fund', r() < 0.5 ? 'Equity' : 'Debt'), ['Booked Fund', { cls: 'Equity' }]]),
    sales: realized,
    slab: 0.3,
  };
}

// Exhaustive search over how much to take from the first fund (the second fund covers the rest)
function bruteForce(model, amount) {
  const fy = model.currentFy;
  const base = model.recordsFor(fy);
  const baseTax = model.computeTaxFor(base, fy).total;
  const [a, b] = model.funds.filter((f) => f.nav && f.sellableUnits > 0);
  let best = Infinity;
  const steps = 600;
  for (let i = 0; i <= steps; i++) {
    const ua = (a.sellableUnits * i) / steps;
    const rest = amount - ua * a.nav.nav;
    const ub = Math.max(0, rest) / b.nav.nav;
    if (ub > b.sellableUnits + 1e-9) continue;
    const sales = [{ id: 'a', fund: a.name, units: ua, nav: a.nav.nav, date: model.today }, { id: 'b', fund: b.name, units: ub, nav: b.nav.nav, date: model.today }].filter((s) => s.units > 0);
    const { matches } = applySales(model.lots, sales);
    best = Math.min(best, model.computeTaxFor([...base, ...matches.map(model.enrichMatch)], fy).total - baseTax);
  }
  return best;
}

describe('withdrawal optimiser', () => {
  it('raises the amount asked for, from unlocked units only', () => {
    const model = makeModel(randomPortfolio(7));
    const plan = planWithdrawal(model, 50000);
    expect(plan.raised).toBeGreaterThanOrEqual(50000 - 0.5);
    expect(plan.raised).toBeLessThan(50000 + 300); // at most one unit's worth over
  });

  it('reports a shortfall instead of overselling', () => {
    const model = makeModel(randomPortfolio(11));
    const plan = planWithdrawal(model, 1e9);
    expect(plan.shortfall).toBeGreaterThan(0);
    expect(plan.raised).toBeCloseTo(plan.available, 0);
  });

  it('is never worse than selling every fund equally', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const model = makeModel(randomPortfolio(seed));
      const plan = planWithdrawal(model, 40000 + seed * 3000);
      expect(plan.extraTax).toBeLessThanOrEqual(plan.baselineExtraTax + 0.5);
    }
  });

  it('matches an exhaustive search on two-fund portfolios (within ₹1 or 1%)', () => {
    const gaps = [];
    for (let seed = 1; seed <= 25; seed++) {
      const model = makeModel(randomPortfolio(seed));
      const amount = 40000 + seed * 3000;
      const plan = planWithdrawal(model, amount);
      if (plan.shortfall > 0) continue;
      const best = bruteForce(model, amount);
      gaps.push({ seed, greedy: plan.extraTax, best, gap: plan.extraTax - best });
    }
    const worst = gaps.reduce((w, g) => (g.gap > w.gap ? g : w), { gap: -Infinity });
    expect(gaps.length).toBeGreaterThan(15);
    for (const g of gaps) expect(g.gap, `seed ${g.seed}: greedy ${g.greedy.toFixed(0)} vs best ${g.best.toFixed(0)}`).toBeLessThanOrEqual(Math.max(1, Math.abs(g.best) * 0.01));
    console.log(`withdrawal: ${gaps.length} cases, worst gap ₹${worst.gap.toFixed(2)} (seed ${worst.seed})`);
  });
});
