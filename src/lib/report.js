import { HEADS, RATE_SWITCH } from './tax';
import { fyLabel, formatDate } from './dates';

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\n');
const r2 = (v) => (v == null ? '' : v.toFixed(2));

export function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  // A byte-order mark makes Excel read ₹ correctly in CSVs; calendar files must not have one
  const blob = new Blob(type.startsWith('text/csv') ? ['﻿', content] : [content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Lot-level statement: one line per (sale × purchase lot) pair
export function capitalGainsCsv(tax, navs) {
  const header = ['Scheme', 'ISIN', 'Asset class', 'Purchase date', 'Sale date', 'Units', 'Purchase NAV', 'Sale NAV',
    'Cost of acquisition', 'Indexed cost', 'Sale value', 'Gain', 'Taxable gain', 'Term', 'Tax head', 'Section', 'Transfer period', 'Simulated'];
  const rows = tax.records
    .slice()
    .sort((a, b) => a.sellDate.localeCompare(b.sellDate) || a.fund.localeCompare(b.fund))
    .map((r) => [
      r.fund, navs[r.fund]?.isin ?? '', r.assetClass, formatDate(r.buyDate), formatDate(r.sellDate), r.units.toFixed(3),
      r.buyNav.toFixed(4), r.sellNav.toFixed(4), r2(r.cost), r2(r.indexedCost), r2(r.proceeds), r2(r.gain), r2(r.taxableGain),
      r.term === 'LT' ? 'Long-term' : 'Short-term', HEADS[r.head].label, HEADS[r.head].section,
      r.sellDate < RATE_SWITCH ? 'Before 23-Jul-2024' : 'On/after 23-Jul-2024', r.simulated ? 'Yes' : '',
    ]);
  return toCsv([[`Capital gains statement — ${fyLabel(tax.fy)}`], [], header, ...rows]);
}

// Scrip-wise rows in the shape of ITR Schedule 112A (equity LTCG), aggregated per fund and transfer period
export function schedule112ACsv(tax, navs) {
  // Columns follow ITR-2 Schedule 112A (1)–(14)
  const header = ['Share/Unit acquired', 'ISIN Code', 'Name of the Share/Unit', 'No. of Shares/Units', 'Sale-price per Share/Unit',
    'Full Value of Consideration', 'Cost of acquisition without indexation (higher of 8 and 9)', 'Cost of acquisition',
    'Lower of FMV (11) and consideration (6)', 'FMV per unit as on 31.01.2018', 'Total FMV as on 31.01.2018',
    'Expenditure on transfer', 'Total deductions', 'Balance', 'Transfer period'];
  const groups = new Map();
  for (const r of tax.records.filter((x) => x.head === 'EQ_LT_POST' || x.head === 'EQ_LT_PRE')) {
    const acquired = r.buyDate < '2018-02-01' ? 'BE' : 'AE';
    const period = r.sellDate < RATE_SWITCH ? 'Before 23-Jul-2024' : 'On/after 23-Jul-2024';
    const key = `${r.fund}|${acquired}|${period}`;
    const g = groups.get(key) ?? { fund: r.fund, acquired, period, units: 0, proceeds: 0, cost: 0, basis: 0, lowerOf: 0 };
    const fmv = navs[r.fund]?.fmv2018;
    g.units += r.units;
    g.proceeds += r.proceeds;
    g.cost += r.cost;
    g.basis += r.grandfatheredCost ?? r.cost;
    if (acquired === 'BE' && fmv) g.lowerOf += Math.min(r.units * fmv, r.proceeds);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => {
    const fmv = navs[g.fund]?.fmv2018;
    const be = g.acquired === 'BE';
    return [
      g.acquired, navs[g.fund]?.isin ?? '', g.fund, g.units.toFixed(3), r2(g.proceeds / g.units), r2(g.proceeds),
      r2(g.basis), r2(g.cost),
      be ? (fmv ? r2(g.lowerOf) : 'Fetch NAVs for FMV') : '',
      be && fmv ? fmv.toFixed(4) : '', be && fmv ? r2(g.units * fmv) : '',
      '0', r2(g.basis), r2(g.proceeds - g.basis), g.period,
    ];
  });
  return toCsv([[`Schedule 112A draft — ${fyLabel(tax.fy)}`], ['AE = acquired on/after 1 Feb 2018, BE = before (needs FMV on 31 Jan 2018)'], [], header, ...rows]);
}
