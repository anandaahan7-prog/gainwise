import { describe, expect, it } from 'vitest';
import { buildIcs, taxDates } from '../src/lib/calendar';
import { buildActions } from '../src/lib/actions';
import { makeModel, daysAgo, monthsAgo } from './helpers';

describe('iCalendar export', () => {
  const events = [
    { date: '2026-11-05', kind: 'long-term', title: 'SBI Gold turns long-term', detail: 'Saves ₹31,281; taxed at 12.5%, not 30%.' },
    { date: '2027-03-15', kind: 'deadline', title: 'Use ₹1,25,000 of tax-free LTCG before 31 March', detail: 'x'.repeat(200) },
  ];
  const ics = buildIcs(events, new Date('2026-10-12T10:00:00Z'));
  const lines = ics.split('\r\n');

  it('uses CRLF line endings and wraps every event', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.includes('\n') && !ics.replace(/\r\n/g, '').includes('\n')).toBe(true);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261105');
    expect(ics).toContain('DTEND;VALUE=DATE:20261106');
  });
  it('escapes commas and semicolons in text', () => {
    expect(ics).toContain('Saves ₹31\\,281\\; taxed at 12.5%\\, not 30%.');
  });
  it('folds lines at 75 octets without splitting characters', () => {
    const enc = new TextEncoder();
    for (const l of lines) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
  });
});

describe('tax dates', () => {
  it('lists the long-term date of a profitable lot and the exemption deadline', () => {
    const model = makeModel({
      funds: {
        'Test Gold Fund Direct Growth': { cls: 'Other', nav: 150, lots: [{ buyDate: daysAgo(700), units: 1000, buyNav: 100 }] },
        'Test Flexi Cap Fund Direct Growth': { cls: 'Equity', nav: 200, lots: [{ buyDate: monthsAgo(30), units: 100, buyNav: 100 }] },
      },
    });
    const dates = taxDates(model, buildActions(model));
    expect(dates.some((d) => d.kind === 'long-term')).toBe(true);
    expect(dates.some((d) => d.kind === 'deadline')).toBe(true);
    expect(dates.map((d) => d.date)).toEqual(dates.map((d) => d.date).sort());
  });
});
