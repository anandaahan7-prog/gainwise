// Turns the computed portfolio into a compact, factual brief for a small on-device model.
// Small models are bad at arithmetic, so every number they might need is precomputed here.
import { inr, units, shortFund } from '../lib/format';
import { fyLabel, formatDate } from '../lib/dates';
import { gainHarvestPlan, lossHarvestCandidates, waitAndSave } from '../lib/planner';
import { buildInsights } from '../lib/insights';

function taxBlock(tax) {
  const heads = tax.rows
    .filter((r) => r.gains > 0.5 || r.losses > 0.5)
    .map((r) => `  - ${r.label} (${r.section}): gains ${inr(r.gains)}, losses ${inr(r.losses)}, taxable ${inr(r.taxable)} @ ${(r.rate * 100).toFixed(1)}% = tax ${inr(r.tax)}`)
    .join('\n');
  return [
    `Short-term capital gains (net): ${inr(tax.stcg)}`,
    `Long-term capital gains (net): ${inr(tax.ltcg)}`,
    `Equity LTCG exemption: limit ${inr(tax.limit)}, used ${inr(tax.exemptionUsed)}, left ${inr(tax.exemptionLeft)}`,
    `Tax by head:\n${heads || '  - none'}`,
    `Tax before cess ${inr(tax.baseTax)}, cess ${inr(tax.cess)}, total estimated tax ${inr(tax.total)}`,
    `Losses to carry forward: short-term ${inr(tax.carryForward.st)}, long-term ${inr(tax.carryForward.lt)}`,
  ].join('\n');
}

export function buildContext(model, tax) {
  const current = model.taxFor(model.currentFy);
  const harvest = gainHarvestPlan(model);
  const losses = lossHarvestCandidates(model).slice(0, 4);
  const waits = waitAndSave(model).slice(0, 5);
  const held = model.funds.filter((f) => f.units > 1e-6);

  const holdings = held
    .slice(0, 14)
    .map((f) => {
      const parts = [`${shortFund(f.name)} [${f.assetClass}]: ${units(f.units)} units, invested ${inr(f.cost)}`];
      if (f.value != null) parts.push(`value ${inr(f.value)}, unrealized ${inr(f.gain)}`);
      parts.push(`long-term units ${units(f.ltUnits)}`);
      if (f.nextLt) parts.push(`next lot turns long-term ${formatDate(f.nextLt)}`);
      return `  - ${parts.join(', ')}`;
    })
    .join('\n');

  const sections = [
    `Today is ${formatDate(model.today)}. Current financial year: ${fyLabel(model.currentFy)} (ends 31 Mar ${model.currentFy + 1}). User's income-tax slab: ${Math.round(model.slab * 100)}%.`,
    `RULES (India, mutual funds): Equity funds are long-term after 12 months; for sales from 23 Jul 2024 STCG is 20% and LTCG is 12.5% above a ₹1.25 lakh yearly exemption (earlier: 15% / 10% above ₹1 lakh). Debt funds bought on/after 1 Apr 2023 are always taxed at the slab rate. Short-term losses offset any gains; long-term losses offset only long-term gains. 4% cess applies. Units are sold FIFO (oldest first).`,
    `SELECTED YEAR ${fyLabel(tax.fy)}:\n${taxBlock(tax)}`,
  ];
  if (tax.fy !== model.currentFy) sections.push(`CURRENT YEAR ${fyLabel(model.currentFy)}:\n${taxBlock(current)}`);
  sections.push(`HOLDINGS (${held.length} funds):\n${holdings || '  - none'}`);
  sections.push(
    `GAIN-HARVEST PLAN for ${fyLabel(model.currentFy)}: ` +
      (harvest.plan.length
        ? `sell and rebuy ${harvest.plan.map((p) => `${units(p.units)} units of ${shortFund(p.fund)} (books ${inr(p.gain)})`).join('; ')}. Total tax-free LTCG booked ${inr(harvest.harvested)}, future tax avoided about ${inr(harvest.futureSaving)}.`
        : harvest.room < 1
          ? 'exemption already used up.'
          : 'nothing available (no priced long-term equity units in profit).'),
  );
  sections.push(
    `LOSS-HARVEST CANDIDATES: ` +
      (losses.length ? losses.map((l) => `${shortFund(l.fund)}: selling all units realizes ${inr(l.st + l.lt)} and saves ${inr(l.saving)} tax`).join('; ') : 'none.'),
  );
  sections.push(
    `WAIT-AND-SAVE (lots turning long-term soon): ` +
      (waits.length ? waits.map((w) => `${shortFund(w.fund)} lot of ${units(w.units)} units becomes long-term on ${formatDate(w.ltFrom)} (${w.daysToLt} days), waiting saves ${inr(w.saving)}`).join('; ') : 'none.'),
  );
  if (held.some((f) => !f.nav)) sections.push('Note: some funds have no current NAV, so their current value and unrealized gains are unknown.');
  const insights = buildInsights(model, tax).map((i) => `  - ${i.title}`).join('\n');
  if (insights) sections.push(`KEY INSIGHTS:\n${insights}`);
  return sections.join('\n\n');
}

export const SYSTEM_PROMPT = `You are a friendly, careful assistant inside a private mutual-fund tax calculator for Indian investors. You run fully on the user's device.
Answer using ONLY the facts in the PORTFOLIO DATA below. Quote rupee amounts exactly as given; do not do new arithmetic unless it is trivial. If the data doesn't contain the answer, say so.
Be concise: short paragraphs or bullet points, under 180 words. Explain jargon (STCG, LTCG, FIFO, harvesting) in plain words when you use it.
You are not a chartered accountant; for filing decisions suggest confirming with a CA. Never invent fund names, dates or numbers.`;

export const SUGGESTIONS = [
  'Summarize my capital gains tax in simple words',
  'How much can I sell tax-free this year?',
  'Which units should I avoid selling right now and why?',
  'Can I reduce my tax with tax-loss harvesting?',
  'Explain why my debt fund gains are taxed at slab rate',
];
