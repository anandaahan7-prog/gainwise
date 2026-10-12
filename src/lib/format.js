const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const inr = (v, { paise = false } = {}) => (paise ? inrPaise : inrFull).format(Math.abs(v) < 0.005 ? 0 : v);

// ₹1.25L / ₹3.4Cr style, for chart labels and compact tiles
export const inrCompact = (v) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};

export const units = (v) => plain.format(v);

export const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;

export const signClass = (v) => (v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '');

// Short, readable fund label: drop the plan/option suffixes that every row shares
export const shortFund = (name) =>
  name
    .replace(/\s*[-–]?\s*(direct|regular)\s*(plan)?\s*[-–]?\s*(growth)?\s*(option)?$/i, '')
    .replace(/\s+(direct\s+)?growth$/i, '')
    .replace(/(?<!\bof)\s+fund$/i, '') // keep "Fund of Fund" intact
    .trim();
