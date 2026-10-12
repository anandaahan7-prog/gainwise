import { describe, expect, it } from 'vitest';
import { gainHarvestPlan, lossHarvestCandidates, waitAndSave, taxDelta } from '../src/lib/planner';
import { buildActions } from '../src/lib/actions';
import { makeModel, monthsAgo, daysAgo, today } from './helpers';

const FLEXI = 'Test Flexi Cap Fund Direct Growth';
const DIGITAL = 'Test Digital India Fund Direct Growth';
const ELSS = 'Test ELSS Tax Saver Fund Direct Growth';
const GOLD = 'Test Gold Fund Direct Growth';

describe('gain harvesting', () => {
  const model = makeModel({
    funds: {
      [FLEXI]: { cls: 'Equity', nav: 200, lots: [{ buyDate: monthsAgo(30), units: 5000, buyNav: 100 }] },
    },
  });
  it('books exactly the unused ₹1.25L exemption', () => {
    const plan = gainHarvestPlan(model);
    expect(plan.room).toBeCloseTo(125000, 2);
    expect(plan.harvested).toBeLessThanOrEqual(125000);
    expect(plan.harvested).toBeGreaterThan(125000 - 1);
    expect(plan.plan[0].units).toBeCloseTo(1250, 2); // ₹100 gain per unit
  });
  it('adds no tax today (verified by re-running the tax engine)', () => {
    expect(Math.abs(gainHarvestPlan(model).extraTax)).toBeLessThan(0.5);
  });
  it('never touches locked ELSS units', () => {
    const elss = makeModel({
      funds: { [ELSS]: { cls: 'Equity', nav: 200, lots: [{ buyDate: monthsAgo(18), units: 5000, buyNav: 100 }] } },
    });
    expect(elss.funds[0].lockedUnits).toBeCloseTo(5000, 6);
    expect(gainHarvestPlan(elss).plan).toHaveLength(0);
  });
});

describe('loss harvesting', () => {
  it('saves 20% + cess when a short-term loss offsets short-term gains', () => {
    const model = makeModel({
      funds: { [FLEXI]: { cls: 'Equity' }, [DIGITAL]: { cls: 'Equity', nav: 80, lots: [{ buyDate: monthsAgo(6), units: 1000, buyNav: 100 }] } },
      sales: [{ fund: FLEXI, buyDate: monthsAgo(8), sellDate: today, units: 1000, buyNav: 100, sellNav: 160 }],
    });
    const [c] = lossHarvestCandidates(model);
    expect(c.fund).toBe(DIGITAL);
    expect(c.saving).toBeCloseTo(20000 * 0.2 * 1.04, 2);
  });
  it('finds nothing to save when the gains are already tax-free', () => {
    const model = makeModel({
      funds: { [FLEXI]: { cls: 'Equity' }, [DIGITAL]: { cls: 'Equity', nav: 80, lots: [{ buyDate: monthsAgo(20), units: 1000, buyNav: 100 }] } },
      sales: [{ fund: FLEXI, buyDate: monthsAgo(30), sellDate: today, units: 500, buyNav: 100, sellNav: 200 }],
    });
    expect(lossHarvestCandidates(model)).toHaveLength(0); // ₹50k LTCG is inside the exemption
  });
});

describe('wait and save', () => {
  it('flags a profitable gold lot shortly before it turns long-term', () => {
    const model = makeModel({
      funds: { [GOLD]: { cls: 'Other', nav: 150, lots: [{ buyDate: daysAgo(700), units: 1000, buyNav: 100 }] } },
    });
    const [w] = waitAndSave(model);
    expect(w.fund).toBe(GOLD);
    expect(w.saving).toBeCloseTo(50000 * (0.3 - 0.125) * 1.04, 2);
  });
});

describe('tax delta and actions', () => {
  it('counts brought-forward losses in what-if tax', () => {
    const funds = { [FLEXI]: { cls: 'Equity', nav: 200, lots: [{ buyDate: monthsAgo(6), units: 1000, buyNav: 100 }] } };
    const plain = taxDelta(makeModel({ funds }), [{ id: 's', fund: FLEXI, units: 1000, nav: 200 }]);
    const withBf = taxDelta(makeModel({ funds, bfLosses: { [makeModel({ funds }).currentFy]: { st: 100000, lt: 0 } } }), [{ id: 's', fund: FLEXI, units: 1000, nav: 200 }]);
    expect(plain.delta).toBeCloseTo(100000 * 0.2 * 1.04, 2);
    expect(withBf.delta).toBeCloseTo(0, 2);
  });
  it('ranks actions by rupees saved', () => {
    const model = makeModel({
      funds: {
        [FLEXI]: { cls: 'Equity', nav: 200, lots: [{ buyDate: monthsAgo(30), units: 5000, buyNav: 100 }] },
        [GOLD]: { cls: 'Other', nav: 150, lots: [{ buyDate: daysAgo(700), units: 1000, buyNav: 100 }] },
      },
    });
    const { actions } = buildActions(model);
    const savings = actions.map((a) => a.saving);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
  });
});
