// Tax planning for the current financial year: gain harvesting, loss harvesting, "wait and save".
import { applySales } from './portfolio';
import { CESS } from './tax';

/** Tax effect of selling `sales` today, on top of everything already realized (and simulated) this FY. */
export function taxDelta(model, sales) {
  const base = model.taxFor(model.currentFy);
  const { matches } = applySales(model.lots, sales.map((s) => ({ date: model.today, ...s })));
  const extra = matches.map(model.enrichMatch);
  const after = model.computeTaxFor([...base.records, ...extra], model.currentFy);
  return { base, after, delta: after.total - base.total, extra };
}

const floor3 = (v) => Math.floor(v * 1000) / 1000;

/**
 * Use the remaining equity-LTCG exemption by selling (and re-buying) long-term units.
 * FIFO means a fund's oldest units go first, so we walk each fund's lots in order and
 * stop at the first lot that is short-term or under water.
 */
export function gainHarvestPlan(model) {
  const base = model.taxFor(model.currentFy);
  const room = base.exemptionLeft;
  const missingNav = model.funds.filter((f) => f.assetClass === 'Equity' && f.units > 0 && !f.nav).map((f) => f.name);
  if (room < 1) return { room: 0, plan: [], harvested: 0, missingNav, base };

  const candidates = model.funds
    .filter((f) => f.assetClass === 'Equity' && f.nav && f.units > 0)
    .map((f) => {
      const segs = [];
      for (const lot of f.lots) {
        // Taxable gain per unit (grandfathered cost for pre-2018 units)
        if (lot.locked || lot.term !== 'LT' || lot.nav <= lot.basisNav) break;
        segs.push({ units: lot.units, gpu: lot.nav - lot.basisNav });
      }
      const gain = segs.reduce((a, s) => a + s.units * s.gpu, 0);
      const value = segs.reduce((a, s) => a + s.units * f.nav.nav, 0);
      return { fund: f, segs, gain, ratio: value ? gain / value : 0 };
    })
    .filter((c) => c.gain > 0)
    .sort((a, b) => b.ratio - a.ratio); // most gain per rupee sold first

  let left = room;
  const plan = [];
  for (const c of candidates) {
    if (left < 1) break;
    let u = 0;
    let g = 0;
    for (const s of c.segs) {
      const full = s.units * s.gpu;
      if (full <= left - g) {
        u += s.units;
        g += full;
      } else {
        const part = floor3((left - g) / s.gpu);
        u += part;
        g += part * s.gpu;
        break;
      }
    }
    u = floor3(u);
    if (u <= 0) continue;
    plan.push({ fund: c.fund.name, units: u, nav: c.fund.nav.nav, value: u * c.fund.nav.nav, gain: g });
    left -= g;
  }
  const harvested = plan.reduce((a, p) => a + p.gain, 0);
  const check = plan.length ? taxDelta(model, plan.map((p, i) => ({ id: `harvest-${i}`, fund: p.fund, units: p.units, nav: p.nav }))) : null;
  return {
    room,
    plan,
    harvested,
    extraTax: check ? check.delta : 0,
    futureSaving: harvested * 0.125 * (1 + CESS),
    missingNav,
    base,
  };
}

/** Funds whose full sale today would lower this year's tax (losses offsetting realized gains). */
export function lossHarvestCandidates(model) {
  return model.funds
    .filter((f) => f.nav && f.sellableUnits > 1e-6 && f.gain != null && f.gain < 0)
    .map((f) => {
      // Only units that can be sold today (locked ELSS units are skipped)
      const d = taxDelta(model, [{ id: `loss-${f.name}`, fund: f.name, units: f.sellableUnits, nav: f.nav.nav }]);
      const st = d.extra.filter((r) => r.term === 'ST').reduce((a, r) => a + r.gain, 0);
      const lt = d.extra.filter((r) => r.term === 'LT').reduce((a, r) => a + r.gain, 0);
      return { fund: f.name, units: f.sellableUnits, value: f.sellableUnits * f.nav.nav, gain: st + lt, st, lt, saving: -d.delta };
    })
    .filter((c) => c.saving > 1)
    .sort((a, b) => b.saving - a.saving);
}

/** Lots in profit that turn long-term within a year: selling before that date costs extra tax. */
export function waitAndSave(model, horizonDays = 366) {
  return model.lots
    .filter((l) => !l.locked && l.term === 'ST' && l.ltFrom && l.daysToLt > 0 && l.daysToLt <= horizonDays && l.gain > 0)
    .map((l) => {
      const stRate = l.assetClass === 'Equity' ? 0.2 : model.slab;
      const saving = l.gain * (stRate - 0.125) * (1 + CESS);
      return { ...l, stRate, saving };
    })
    .filter((l) => l.saving >= 50) // skip trivial SIP instalments
    .sort((a, b) => a.ltFrom.localeCompare(b.ltFrom));
}
