import { describe, expect, it } from 'vitest';
import { treatment, enrich, computeTax, grandfatheredNav, isElss, elssUnlockDate } from '../src/lib/tax';
import { addMonths, fyOf } from '../src/lib/dates';

const R = (head, term, gain) => ({ head, term, gain, taxableGain: gain });

describe('holding period and tax head', () => {
  it('clamps month arithmetic to the end of the month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
  it('equity is long-term only after more than 12 months', () => {
    expect(treatment('Equity', '2023-01-01', '2024-01-01').term).toBe('ST');
    expect(treatment('Equity', '2023-01-01', '2024-01-02').head).toBe('EQ_LT_PRE');
    expect(treatment('Equity', '2023-01-01', '2024-08-01').head).toBe('EQ_LT_POST');
    expect(treatment('Equity', '2024-03-01', '2024-07-22').head).toBe('EQ_ST_PRE');
  });
  it('applies Section 50AA to debt bought on or after 1 Apr 2023', () => {
    expect(treatment('Debt', '2023-04-01', '2027-01-01').head).toBe('SLAB_ST');
  });
  it('uses 24 months (12.5%) after 23 Jul 2024 and 36 months (indexed) before', () => {
    expect(treatment('Debt', '2022-05-01', '2024-06-10').head).toBe('SLAB_ST');
    expect(treatment('Debt', '2022-05-01', '2024-08-10').head).toBe('LT_112');
    expect(treatment('Debt', '2020-05-01', '2024-06-10').head).toBe('LT_IDX');
  });
  it('treats gold/international as specified only for sales before Apr 2025', () => {
    expect(treatment('Other', '2023-06-01', '2024-11-04').head).toBe('SLAB_ST');
    expect(treatment('Other', '2023-06-01', '2025-07-01').head).toBe('LT_112');
    expect(treatment('Other', '2025-02-03', '2026-10-10').ltFrom).toBe('2027-02-04');
  });
});

describe('yearly computation', () => {
  it('sets off short-term losses against the costliest head, then applies the exemption', () => {
    const t = computeTax([R('EQ_LT_POST', 'LT', 200000), R('EQ_ST_POST', 'ST', -50000), R('SLAB_ST', 'ST', 30000)], 2024, 0.3);
    expect(t.baseTax).toBeCloseTo(6875, 2);
    expect(t.total).toBeCloseTo(7150, 2);
  });
  it('never sets long-term losses against short-term gains', () => {
    const t = computeTax([R('EQ_LT_POST', 'LT', -10000), R('EQ_ST_POST', 'ST', 40000)], 2024, 0.3);
    expect(t.baseTax).toBeCloseTo(8000, 2);
    expect(t.carryForward.lt).toBeCloseTo(10000, 2);
  });
  it('uses the FY 2024-25 exemption on 12.5% gains before 10% gains', () => {
    expect(computeTax([R('EQ_LT_PRE', 'LT', 80000), R('EQ_LT_POST', 'LT', 80000)], 2024, 0.3).baseTax).toBeCloseTo(3500, 2);
  });
  it('uses the ₹1L exemption and 10% rate before FY 2024-25', () => {
    expect(computeTax([R('EQ_LT_PRE', 'LT', 150000)], 2023, 0.3).baseTax).toBeCloseTo(5000, 2);
  });
  it('indexes debt cost with the CII of the sale and purchase years', () => {
    const e = enrich({ fund: 'x', buyDate: '2019-05-01', sellDate: '2024-05-01', units: 100, buyNav: 10, sellNav: 15, cost: 1000, proceeds: 1500 }, 'Debt');
    expect(e.indexedCost).toBeCloseTo((1000 * 363) / 289, 4);
  });
});

describe('losses brought forward (Sec 74)', () => {
  it('lets brought-forward short-term losses absorb any gain', () => {
    const t = computeTax([R('EQ_ST_POST', 'ST', 50000), R('EQ_LT_POST', 'LT', 200000)], 2025, 0.3, { st: 60000, lt: 0 });
    // 50k absorbs all STCG, the other 10k reduces LTCG to 190k; 65k above the limit at 12.5%
    expect(t.baseTax).toBeCloseTo(8125, 2);
    expect(t.broughtForward.used).toBeCloseTo(60000, 2);
  });
  it('never lets brought-forward long-term losses absorb short-term gains', () => {
    const t = computeTax([R('EQ_ST_POST', 'ST', 50000)], 2025, 0.3, { st: 0, lt: 40000 });
    expect(t.baseTax).toBeCloseTo(10000, 2);
    expect(t.broughtForward.left.lt).toBeCloseTo(40000, 2);
  });
  it("applies this year's losses before brought-forward ones", () => {
    const t = computeTax([R('SLAB_ST', 'ST', 30000), R('EQ_ST_POST', 'ST', -20000)], 2025, 0.3, { st: 25000, lt: 0 });
    expect(t.baseTax).toBeCloseTo(0, 2);
    expect(t.broughtForward.used).toBeCloseTo(10000, 2);
    expect(t.broughtForward.left.st).toBeCloseTo(15000, 2);
  });
});

describe('grandfathering (Sec 55(2)(ac))', () => {
  it('takes the higher of cost and the lower of FMV and sale value', () => {
    expect(grandfatheredNav(20.79, 24.6526, 88.9747)).toBeCloseTo(24.6526, 4);
    expect(grandfatheredNav(30, 24.6526, 88)).toBe(30);
    expect(grandfatheredNav(20, 24.6526, 22)).toBe(22);
  });
  it('reduces the taxable gain on pre-2018 units', () => {
    const g = enrich({ fund: 'x', buyDate: '2017-06-01', sellDate: '2024-12-10', units: 3000, buyNav: 20.79, sellNav: 88.9747, cost: 62370, proceeds: 266924.1 }, 'Equity', 24.6526);
    expect(g.taxableGain).toBeCloseTo(192966.3, 1);
  });
});

describe('ELSS', () => {
  it('recognises ELSS by AMFI category or name', () => {
    expect(isElss('Axis ELSS Tax Saver Fund Direct Growth')).toBe(true);
    expect(isElss('Mirae Asset Tax Saver Fund', '')).toBe(true);
    expect(isElss('Some Fund', 'Equity Scheme - ELSS')).toBe(true);
    expect(isElss('Parag Parikh Flexi Cap Fund')).toBe(false);
  });
  it('locks units for three years from purchase', () => {
    expect(elssUnlockDate('2024-02-29')).toBe('2027-02-28');
    expect(fyOf('2027-02-28')).toBe(2026);
  });
});
