// "Save tax" screen: every planner opportunity as one ranked list of action cards.
import { gainHarvestPlan, lossHarvestCandidates, waitAndSave, taxDelta } from './planner';
import { inr, shortFund } from './format';
import { formatDate } from './dates';

export function buildActions(model) {
  const actions = [];

  const harvest = gainHarvestPlan(model);
  if (harvest.plan.length) {
    actions.push({
      id: 'harvest',
      kind: 'harvest',
      icon: '🌱',
      title: `Book ${inr(harvest.harvested)} of long-term gains tax-free`,
      why: `Sell and buy back the same day. ${inr(harvest.room)} of this year's ₹1.25L exemption is unused, and it can't be carried forward. Your cost price resets higher, so you pay less tax later.`,
      saving: harvest.futureSaving,
      savingLabel: 'future tax avoided',
      sales: harvest.plan.map((p) => ({ fund: p.fund, units: p.units, nav: p.nav })),
      rows: harvest.plan.map((p) => ({ fund: p.fund, units: p.units, value: p.value, note: `books ${inr(p.gain)} LTCG` })),
    });
  }

  const losses = lossHarvestCandidates(model);
  for (const c of losses) {
    actions.push({
      id: `loss:${c.fund}`,
      kind: 'loss',
      icon: '✂️',
      title: `Sell ${shortFund(c.fund)} to offset this year's gains`,
      why: `It's ${inr(Math.abs(c.st + c.lt))} below cost. Booking that loss reduces the tax on gains you've already made this year. Buy back later (or a similar fund) if you still want the exposure.`,
      saving: c.saving,
      savingLabel: 'tax saved this year',
      sales: [{ fund: c.fund, units: c.units, nav: model.funds.find((f) => f.name === c.fund).nav.nav }],
      rows: [{ fund: c.fund, units: c.units, value: c.value, note: `${c.st < 0 ? `short-term loss ${inr(c.st)}` : ''}${c.st < 0 && c.lt < 0 ? ', ' : ''}${c.lt < 0 ? `long-term loss ${inr(c.lt)}` : ''}` }],
    });
  }

  // One card per fund: its profitable lots that turn long-term soon
  const byFund = new Map();
  for (const w of waitAndSave(model)) {
    const g = byFund.get(w.fund) ?? { fund: w.fund, lots: [], saving: 0, gain: 0, units: 0 };
    g.lots.push(w);
    g.saving += w.saving;
    g.gain += w.gain;
    g.units += w.units;
    byFund.set(w.fund, g);
  }
  for (const g of byFund.values()) {
    const first = g.lots[0];
    const rate = Math.round(first.stRate * 100);
    actions.push({
      id: `wait:${g.fund}`,
      kind: 'wait',
      icon: '⏳',
      title: `Don't sell ${shortFund(g.fund)} before ${formatDate(first.ltFrom)}`,
      why: `${g.lots.length > 1 ? `${g.lots.length} lots turn` : 'This lot turns'} long-term ${first.daysToLt === 1 ? 'tomorrow' : `in ${first.daysToLt} days`}. Until then a sale is taxed at ${rate}%; after, at 12.5%.`,
      saving: g.saving,
      savingLabel: 'extra tax avoided',
      lots: g.lots,
      rows: g.lots.map((l) => ({ fund: l.fund, units: l.units, value: l.value, note: `long-term from ${formatDate(l.ltFrom)} · gain ${inr(l.gain)}` })),
      days: first.daysToLt,
    });
  }

  actions.sort((a, b) => b.saving - a.saving);

  // Headline: loss sales are evaluated together (they compete for the same gains), the rest add up
  const lossSales = actions.filter((a) => a.kind === 'loss').flatMap((a) => a.sales);
  const lossTotal = lossSales.length ? Math.max(0, -taxDelta(model, lossSales.map((s, i) => ({ id: `all-loss-${i}`, ...s }))).delta) : 0;
  const total = (harvest.plan.length ? harvest.futureSaving : 0) + lossTotal + actions.filter((a) => a.kind === 'wait').reduce((a, w) => a + w.saving, 0);

  return { actions, total, harvest, missingNav: harvest.missingNav };
}
