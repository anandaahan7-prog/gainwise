// Indian capital-gains rules for mutual fund units (resident individuals).
// Simplified on purpose: no surcharge, no grandfathering (31 Jan 2018 FMV),
// no basic-exemption shortfall adjustment. Everything here is an estimate.
import { addMonths, addDays, fyOf } from './dates';

export const ASSET_CLASSES = ['Equity', 'Debt', 'Other', 'Unknown'];

export const CLASS_INFO = {
  Equity: 'Equity-oriented (≥65% Indian equity, incl. arbitrage & index funds). Long-term after 12 months.',
  Debt: 'Specified fund (>65% debt). Units bought from 1 Apr 2023 are always taxed at your slab rate.',
  Other: 'Gold, international, FoF and hybrid funds that are neither equity- nor debt-oriented.',
  Unknown: 'Not classified yet. Taxed like debt (slab rate) until you pick a class.',
};

export const RATE_SWITCH = '2024-07-23'; // Finance (No. 2) Act 2024: new rates for transfers on/after this date
export const SPECIFIED_MF_CUTOFF = '2023-04-01'; // Sec 50AA: purchases on/after this date
export const SPECIFIED_MF_REDEFINED = '2025-04-01'; // Sec 50AA narrowed to >65% debt funds for transfers on/after this date
export const CESS = 0.04;

// Cost Inflation Index, keyed by FY start year (used only for indexed debt LTCG on sales before 23 Jul 2024)
const CII = {
  2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129, 2008: 137,
  2009: 148, 2010: 167, 2011: 184, 2012: 200, 2013: 220, 2014: 240, 2015: 254, 2016: 264,
  2017: 272, 2018: 280, 2019: 289, 2020: 301, 2021: 317, 2022: 331, 2023: 348, 2024: 363, 2025: 376,
};
const cii = (fy) => CII[Math.min(Math.max(fy, 2001), 2025)];

export const HEADS = {
  EQ_ST_POST: { label: 'Equity STCG', section: 'Sec 111A', term: 'ST', rate: 0.2 },
  EQ_ST_PRE: { label: 'Equity STCG (before 23 Jul 2024)', section: 'Sec 111A', term: 'ST', rate: 0.15 },
  SLAB_ST: { label: 'STCG at slab rate', section: 'Slab · Sec 50AA', term: 'ST', rate: null },
  EQ_LT_POST: { label: 'Equity LTCG', section: 'Sec 112A', term: 'LT', rate: 0.125, hasExemption: true },
  EQ_LT_PRE: { label: 'Equity LTCG (before 23 Jul 2024)', section: 'Sec 112A', term: 'LT', rate: 0.1, hasExemption: true },
  LT_112: { label: 'Non-equity LTCG', section: 'Sec 112', term: 'LT', rate: 0.125 },
  LT_IDX: { label: 'Non-equity LTCG (indexed)', section: 'Sec 112', term: 'LT', rate: 0.2 },
};
export const HEAD_ORDER = Object.keys(HEADS);
// Each tax head keeps one fixed chart color everywhere
export const headColor = (key) => `var(--series-${HEAD_ORDER.indexOf(key) + 1})`;

export const exemptionLimit = (fyStart) => (fyStart >= 2024 ? 125000 : 100000);

// First date on which a lot bought on buyISO counts as "held for more than N months"
const longTermFrom = (buyISO, months) => addDays(addMonths(buyISO, months), 1);

/**
 * How a single sale of a lot is taxed.
 * Returns { head, term, ltFrom, deemed } — ltFrom is null when the lot can never become long-term.
 */
export function treatment(assetClass, buyISO, sellISO) {
  const post = sellISO >= RATE_SWITCH;
  if (assetClass === 'Equity') {
    const ltFrom = longTermFrom(buyISO, 12);
    const lt = sellISO >= ltFrom;
    const head = lt ? (post ? 'EQ_LT_POST' : 'EQ_LT_PRE') : post ? 'EQ_ST_POST' : 'EQ_ST_PRE';
    return { head, term: lt ? 'LT' : 'ST', ltFrom, deemed: false };
  }
  // Debt / Unknown: specified fund. Other: specified only until the 2025 redefinition.
  const specified = assetClass !== 'Other' || sellISO < SPECIFIED_MF_REDEFINED;
  if (specified && buyISO >= SPECIFIED_MF_CUTOFF) {
    return { head: 'SLAB_ST', term: 'ST', ltFrom: null, deemed: true };
  }
  const ltFrom = longTermFrom(buyISO, post ? 24 : 36);
  if (sellISO < ltFrom) return { head: 'SLAB_ST', term: 'ST', ltFrom, deemed: false };
  return { head: post ? 'LT_112' : 'LT_IDX', term: 'LT', ltFrom, deemed: false };
}

export const GRANDFATHER_CUTOFF = '2018-02-01'; // equity units bought before this date

/**
 * Sec 55(2)(ac) grandfathering: for equity units acquired before 1 Feb 2018, cost is the higher of
 * the actual cost and the lower of (FMV on 31 Jan 2018, sale value). Per-unit, so it works for lots
 * that are sold (sellNav) or valued today (current NAV).
 */
export const grandfatheredNav = (buyNav, fmv, sellNav) => Math.max(buyNav, Math.min(fmv, sellNav));

// Attach tax treatment to raw FIFO matches. `fmv2018` = the scheme's NAV on 31 Jan 2018, if known.
export function enrich(match, assetClass, fmv2018 = null) {
  const t = treatment(assetClass, match.buyDate, match.sellDate);
  const gain = match.proceeds - match.cost;
  let taxableGain = gain;
  let indexedCost = null;
  let grandfatheredCost = null;
  let needsFmv = false;
  if (t.head === 'LT_IDX') {
    indexedCost = (match.cost * cii(fyOf(match.sellDate))) / cii(fyOf(match.buyDate));
    taxableGain = match.proceeds - indexedCost;
  } else if (t.term === 'LT' && assetClass === 'Equity' && match.buyDate < GRANDFATHER_CUTOFF) {
    if (fmv2018) {
      grandfatheredCost = match.units * grandfatheredNav(match.buyNav, fmv2018, match.sellNav);
      taxableGain = match.proceeds - grandfatheredCost;
    } else {
      needsFmv = true;
    }
  }
  return { ...match, ...t, assetClass, gain, taxableGain, indexedCost, grandfatheredCost, needsFmv, fy: fyOf(match.sellDate) };
}

const headRate = (key, slab) => (key === 'SLAB_ST' ? slab : HEADS[key].rate);

/**
 * Tax for one financial year, with intra-year loss set-off (Sec 70):
 *  - short-term losses can absorb short- or long-term gains
 *  - long-term losses can only absorb long-term gains
 * Losses are applied to the most expensive heads first; equity LTCG is absorbed
 * last because its first ₹1–1.25L is exempt anyway.
 */
export function computeTax(records, fyStart, slab) {
  const heads = {};
  for (const key of HEAD_ORDER) heads[key] = { key, gains: 0, losses: 0, net: 0, setOff: 0, exempt: 0 };
  let stcg = 0;
  let ltcg = 0;
  for (const r of records) {
    const h = heads[r.head];
    if (r.taxableGain >= 0) h.gains += r.taxableGain;
    else h.losses -= r.taxableGain;
    if (r.term === 'ST') stcg += r.gain;
    else ltcg += r.gain;
  }

  let stLoss = 0;
  let ltLoss = 0;
  for (const h of Object.values(heads)) {
    h.net = h.gains - h.losses;
    if (h.net < 0) {
      if (HEADS[h.key].term === 'ST') stLoss -= h.net;
      else ltLoss -= h.net;
      h.net = 0;
    }
  }

  const absorb = (order, pool) => {
    for (const key of order) {
      if (pool <= 0) break;
      const take = Math.min(pool, heads[key].net);
      heads[key].net -= take;
      heads[key].setOff += take;
      pool -= take;
    }
    return pool;
  };
  const ltOrder = ['LT_IDX', 'LT_112', 'EQ_LT_POST', 'EQ_LT_PRE'];
  const stOrder = ['SLAB_ST', 'EQ_ST_POST', 'EQ_ST_PRE'].sort((a, b) => headRate(b, slab) - headRate(a, slab));
  ltLoss = absorb(ltOrder, ltLoss);
  stLoss = absorb(stOrder, stLoss);
  stLoss = absorb(ltOrder, stLoss);

  const limit = exemptionLimit(fyStart);
  const equityLT = heads.EQ_LT_POST.net + heads.EQ_LT_PRE.net;
  let room = limit;
  for (const key of ['EQ_LT_POST', 'EQ_LT_PRE']) {
    heads[key].exempt = Math.min(heads[key].net, room);
    room -= heads[key].exempt;
  }

  let baseTax = 0;
  const rows = HEAD_ORDER.map((key) => {
    const h = heads[key];
    const rate = headRate(key, slab);
    const taxable = Math.max(h.net - h.exempt, 0);
    const tax = taxable * rate;
    baseTax += tax;
    return { ...h, ...HEADS[key], rate, taxable, tax };
  });
  const cess = baseTax * CESS;

  return {
    fy: fyStart,
    rows,
    stcg,
    ltcg,
    limit,
    equityLT,
    exemptionUsed: limit - room,
    exemptionLeft: room,
    baseTax,
    cess,
    total: baseTax + cess,
    carryForward: { st: stLoss, lt: ltLoss },
    records,
  };
}
