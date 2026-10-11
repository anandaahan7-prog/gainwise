import { inr } from './format';
import { fyLabel, formatDate } from './dates';

// Plain-English observations about one financial year. Each: { tone, title, body, action? }
export function buildInsights(model, tax) {
  const out = [];
  const isCurrent = tax.fy === model.currentFy;
  const unknown = model.funds.filter((f) => f.assetClass === 'Unknown');

  if (unknown.length) {
    out.push({
      tone: 'warn',
      title: `${unknown.length} fund${unknown.length > 1 ? 's need' : ' needs'} a tax class`,
      body: `Taxed at your slab rate until you choose Equity, Debt or Other: ${unknown.map((f) => f.name).join(', ')}.`,
      action: 'holdings',
    });
  }

  const missingFmv = tax.records.filter((r) => r.needsFmv);
  if (missingFmv.length) {
    out.push({
      tone: 'warn',
      title: 'Grandfathering not applied yet',
      body: `${missingFmv.length} lot(s) were bought before 1 Feb 2018. Their taxable gain is capped by the NAV on 31 Jan 2018. Fetch live NAVs to pull that value from AMFI; until then the full gain is taxed.`,
      action: 'holdings',
    });
  }

  if (tax.equityLT > tax.limit) {
    out.push({
      tone: 'bad',
      title: 'Equity LTCG exemption exceeded',
      body: `Equity long-term gains of ${inr(tax.equityLT)} are ${inr(tax.equityLT - tax.limit)} over the ${inr(tax.limit)} tax-free limit.${
        isCurrent ? ' Booking losses before 31 March would offset part of this. See the tax planner.' : ''
      }`,
      action: isCurrent ? 'planner' : null,
    });
  } else if (isCurrent && tax.exemptionLeft > 1000) {
    out.push({
      tone: 'good',
      title: `${inr(tax.exemptionLeft)} of tax-free LTCG left in ${fyLabel(tax.fy)}`,
      body: 'Sell long-term equity units and buy them back the same day ("gain harvesting") to raise your cost price at no tax cost. The planner works out exactly how many units.',
      action: 'planner',
    });
  } else if (!isCurrent && tax.exemptionLeft > 1000) {
    out.push({
      tone: 'info',
      title: `${inr(tax.exemptionLeft)} of the exemption went unused`,
      body: `In ${fyLabel(tax.fy)} you could have booked that much more equity LTCG tax-free. The limit resets every year and can't be carried forward.`,
    });
  }

  const slabRow = tax.rows.find((r) => r.key === 'SLAB_ST');
  if (slabRow.gains > 0 && model.slab >= 0.2) {
    const deemed = tax.records.filter((r) => r.deemed && r.gain > 0);
    if (deemed.length) {
      out.push({
        tone: 'info',
        title: 'Debt-fund gains are taxed at your slab rate',
        body: `${inr(deemed.reduce((a, r) => a + r.gain, 0))} came from debt or gold units bought on or after 1 Apr 2023. Under Section 50AA these never qualify as long-term, so they're taxed at ${Math.round(model.slab * 100)}%.`,
      });
    }
  }

  if (tax.carryForward.st > 1 || tax.carryForward.lt > 1) {
    out.push({
      tone: 'info',
      title: 'Losses to carry forward',
      body: `After set-off, ${inr(tax.carryForward.st)} of short-term and ${inr(tax.carryForward.lt)} of long-term losses remain. File your ITR on time to carry them forward for up to 8 years.`,
    });
  }

  const preSwitch = tax.records.some((r) => r.sellDate < '2024-07-23') && tax.records.some((r) => r.sellDate >= '2024-07-23');
  if (preSwitch) {
    out.push({
      tone: 'info',
      title: 'Two rate regimes this year',
      body: 'Sales before 23 Jul 2024 use 15% STCG and 10% LTCG; later sales use 20% and 12.5%. Both are split out in the breakdown and in Schedule 112A.',
    });
  }

  if (isCurrent) {
    const soon = model.lots
      .filter((l) => l.term === 'ST' && l.ltFrom && l.daysToLt > 0 && l.daysToLt <= 60 && (l.gain ?? 1) > 0)
      .sort((a, b) => a.daysToLt - b.daysToLt);
    if (soon.length) {
      out.push({
        tone: 'info',
        title: `${soon.length} lot${soon.length > 1 ? 's' : ''} turn long-term within 60 days`,
        body: `The next one (${soon[0].fund}) becomes long-term on ${formatDate(soon[0].ltFrom)}. Selling those units earlier would be taxed at the higher short-term rate.`,
        action: 'planner',
      });
    }
  }

  if (!tax.records.length) {
    out.push({ tone: 'info', title: `No redemptions in ${fyLabel(tax.fy)}`, body: 'Nothing to tax yet. Use the planner to see what a sale today would cost.' , action: 'planner' });
  }
  return out;
}
