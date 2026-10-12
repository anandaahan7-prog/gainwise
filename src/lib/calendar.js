// Tax reminders as an iCalendar (.ics, RFC 5545) file. Generated in the browser: no account, no server.
import { inr, units, shortFund } from './format';
import { formatDate, addDays, fyLabel } from './dates';

const ADVANCE_TAX = [
  { md: '06-15', pct: 15, fyOffset: 0 },
  { md: '09-15', pct: 45, fyOffset: 0 },
  { md: '12-15', pct: 75, fyOffset: 0 },
  { md: '03-15', pct: 100, fyOffset: 1 },
];

/** Upcoming tax dates for the current financial year, soonest first. */
export function taxDates(model, plan) {
  const today = model.today;
  const fy = model.currentFy;
  const base = model.taxFor(fy, { withSims: false });
  const events = [];

  // Lots turning long-term (one event per fund and date)
  for (const a of plan.actions.filter((x) => x.kind === 'wait')) {
    const byDate = new Map();
    for (const l of a.lots) {
      const g = byDate.get(l.ltFrom) ?? { units: 0, saving: 0, rate: l.stRate };
      g.units += l.units;
      g.saving += l.saving;
      byDate.set(l.ltFrom, g);
    }
    for (const [date, g] of byDate) {
      events.push({
        date,
        kind: 'long-term',
        title: `${shortFund(a.lots[0].fund)} turns long-term`,
        detail: `${units(g.units)} units become long-term. Selling from this date is taxed at 12.5% instead of ${Math.round(g.rate * 100)}%, about ${inr(g.saving)} less tax.`,
      });
    }
  }

  // Use the exemption before the year ends
  if (base.exemptionLeft > 1000) {
    const fyEnd = `${fy + 1}-03-31`;
    const date = `${fy + 1}-03-15` >= today ? `${fy + 1}-03-15` : fyEnd;
    if (date >= today) {
      events.push({
        date,
        kind: 'deadline',
        title: `Use ${inr(base.exemptionLeft)} of tax-free LTCG before 31 March`,
        detail: `Book long-term equity gains up to the ₹1.25L exemption (sell and buy back) before ${formatDate(fyEnd)}. The limit resets on 1 April and can't be carried forward.`,
      });
    }
  }

  // Advance tax instalments still ahead in this FY
  if (base.total >= 1) {
    for (const inst of ADVANCE_TAX) {
      const date = `${fy + inst.fyOffset}-${inst.md}`;
      if (date < today) continue;
      events.push({
        date,
        kind: 'advance-tax',
        title: `Advance tax: ${inst.pct}% of the year's tax due`,
        detail: `Tax on capital gains booked so far in ${fyLabel(fy)}: ${inr(base.total)}. If your total tax for the year (all income, after TDS) is ₹10,000 or more, at least ${inst.pct}% must be paid by this date to avoid interest.`,
      });
    }
  }

  // ELSS lock-ins ending in the next 12 months
  for (const f of model.funds.filter((x) => x.lockedUnits > 1e-6)) {
    const soon = f.lots.filter((l) => l.locked && l.unlocks <= addDays(today, 366));
    const byDate = new Map();
    soon.forEach((l) => byDate.set(l.unlocks, (byDate.get(l.unlocks) ?? 0) + l.units));
    for (const [date, u] of byDate) {
      events.push({ date, kind: 'elss', title: `${shortFund(f.name)}: ELSS units unlock`, detail: `${units(u)} units finish the 3-year lock-in and can be redeemed.` });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- .ics writer
const icsText = (t) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const encoder = new TextEncoder();

// Lines longer than 75 octets are folded: CRLF + one space (multi-byte characters are never split)
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (iso) => iso.replace(/-/g, '');

export function buildIcs(events, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GainWise//Tax reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:GainWise tax reminders'];
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:gainwise-${ymd(e.date)}-${e.kind}-${i}@gainwise`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(e.date, 1))}`,
      `SUMMARY:${icsText(`GainWise: ${e.title}`)}`,
      `DESCRIPTION:${icsText(e.detail)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(e.title)}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
