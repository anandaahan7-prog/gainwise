import { describe, expect, it } from 'vitest';
import { parseNavAll, parseHistoryReport, parseCsv, amfiDateToIso, isoToAmfiDate } from '../server/amfi.js';
import { buildIndex, matchName, tokenize } from '../server/match.js';
import { openDb } from '../server/db.js';

const NAVALL = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Large Cap Fund)

ICICI Prudential Mutual Fund

120586;INF109K016L0;-;ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund);Direct Plan;Growth;112.53;09-Oct-2026
108466;INF109K01BL4;-;ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund);Regular Plan;Growth;101.2;09-Oct-2026

Open Ended Schemes(Equity Scheme - Mid Cap Fund)

Motilal Oswal Mutual Fund

127042;INF247L01445;-;Motilal Oswal Midcap Fund;;;114.9478;09-Oct-2026
127039;INF247L01411;-;Motilal Oswal Midcap Fund;;;99.3871;09-Oct-2026
`;

describe('AMFI parsers', () => {
  it('reads NAVAll with category headings and blank plan columns', () => {
    const rows = parseNavAll(NAVALL, 'now');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ code: 120586, category: 'Equity Scheme - Large Cap Fund', amc: 'ICICI Prudential Mutual Fund', plan: 'Direct Plan', nav: 112.53, nav_date: '2026-10-09' });
    expect(rows[2]).toMatchObject({ code: 127042, category: 'Equity Scheme - Mid Cap Fund', plan: null });
  });
  it('reads the NAV history report', () => {
    const rows = parseHistoryReport('Scheme Code;NAV Name;Plan;Option;ISIN;ISIN2;Net Asset Value;Date\n122639;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;Direct Plan;Growth;INF879O01027;;24.6526;31-Jan-2018\n');
    expect(rows).toEqual([{ code: 122639, date: '2018-01-31', nav: 24.6526 }]);
  });
  it('parses quoted CSV fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,"b, c","say ""hi""","multi\nline"\r\n1,2,3,4')).toEqual([['a', 'b, c', 'say "hi"', 'multi\nline'], ['1', '2', '3', '4']]);
  });
  it('converts AMFI dates both ways', () => {
    expect(amfiDateToIso('9-Oct-2026')).toBe('2026-10-09');
    expect(isoToAmfiDate('2018-01-31')).toBe('31-Jan-2018');
  });
});

describe('fund name matching', () => {
  const schemes = parseNavAll(NAVALL, 'now');
  // Scheme-master names fill in plan/option where NAVAll leaves them blank
  schemes.find((s) => s.code === 127042).nav_name = 'Motilal Oswal Midcap Fund-Direct Plan-Growth Option';
  schemes.find((s) => s.code === 127039).nav_name = 'Motilal Oswal Midcap Fund-Regular Plan-Growth Option';
  const index = buildIndex(schemes);

  it('prefers the Direct plan when the broker name says Direct', () => {
    expect(matchName(index, 'ICICI Prudential Large Cap Fund Direct Growth').best.code).toBe(120586);
    expect(matchName(index, 'Motilal Oswal Midcap Fund Direct Growth').best.code).toBe(127042);
  });
  it('treats "Childrens" and "Children\'s" as the same word', () => {
    expect(tokenize("SBI Children's Fund")).toEqual(tokenize('SBI Childrens Fund'));
  });
  it('returns no match for unrelated names', () => {
    expect(matchName(index, 'Completely Unknown Scheme').best).toBeNull();
  });
});

describe('SQLite store', () => {
  it('upserts schemes and finds the NAV on or before a date', () => {
    const db = openDb(':memory:');
    db.upsertSchemes(parseNavAll(NAVALL, 'now'));
    db.upsertHistory([{ code: 120586, date: '2018-01-30', nav: 43.1 }, { code: 120586, date: '2018-01-31', nav: 43.68 }]);
    expect(db.stats().n).toBe(4);
    expect(db.navOnOrBefore(120586, '2018-02-02')).toEqual({ date: '2018-01-31', nav: 43.68 });
    expect(db.navOnOrBefore(120586, '2018-01-01')).toBeNull();
    db.close();
  });
});
