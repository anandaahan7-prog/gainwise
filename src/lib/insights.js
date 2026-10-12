import { inr } from './format';
import { fyLabel } from './dates';

// Short notes that explain one financial year's computation. Planning ideas live on the Save tax screen.
// Each: { tone: 'good' | 'info' | 'warn' | 'bad', title, body, action? }
export function buildInsights(model, tax) {
  const out = [];
  const isCurrent = tax.fy === model.currentFy;

  const missingFmv = tax.records.filter((r) => r.needsFmv);
  if (missingFmv.length) {
    out.push({
      tone: 'warn',
      title: 'Grandfathering not applied yet',
      body: `${missingFmv.length} lot(s) were bought before 1 Feb 2018. Their taxable gain is capped by the NAV on 31 Jan 2018, which loads with live prices. Until then the full gain is taxed.`,
    });
  }

  if (tax.equityLT > tax.limit) {
    out.push({
      tone: 'bad',
      title: `₹1.25L exemption exceeded by ${inr(tax.equityLT - tax.limit)}`,
      body: `Equity long-term gains of ${inr(tax.equityLT)}; the part above ${inr(tax.limit)} is taxed.${isCurrent ? ' Booking losses before 31 March would reduce it.' : ''}`,
      action: isCurrent ? 'save' : null,
    });
  } else if (isCurrent && tax.exemptionLeft > 1000) {
    out.push({
      tone: 'good',
      title: `${inr(tax.exemptionLeft)} of tax-free gains still unused this year`,
      body: 'The Save tax screen shows exactly what to sell and buy back to use it before 31 March.',
      action: 'save',
    });
  } else if (!isCurrent && tax.exemptionLeft > 1000 && tax.records.length) {
    out.push({
      tone: 'info',
      title: `${inr(tax.exemptionLeft)} of the exemption went unused`,
      body: `In ${fyLabel(tax.fy)} that much more equity LTCG could have been booked tax-free. The limit can't be carried forward.`,
    });
  }

  const deemed = tax.records.filter((r) => r.deemed && r.gain > 0);
  if (deemed.length) {
    out.push({
      tone: 'info',
      title: 'Some gains are taxed at your slab rate',
      body: `${inr(deemed.reduce((a, r) => a + r.gain, 0))} came from debt or gold units bought on or after 1 Apr 2023. Under Section 50AA these never count as long-term.`,
    });
  }

  if (tax.carryForward.st > 1 || tax.carryForward.lt > 1) {
    out.push({
      tone: 'info',
      title: 'Losses to carry forward',
      body: `${inr(tax.carryForward.st)} short-term and ${inr(tax.carryForward.lt)} long-term losses remain. File your ITR on time to use them in the next 8 years.`,
    });
  }

  if (tax.records.some((r) => r.sellDate < '2024-07-23') && tax.records.some((r) => r.sellDate >= '2024-07-23')) {
    out.push({
      tone: 'info',
      title: 'Two rate regimes this year',
      body: 'Sales before 23 Jul 2024 use 15% / 10%; later sales use 20% / 12.5%. Both are shown separately in the detailed calculation.',
    });
  }

  return out;
}
