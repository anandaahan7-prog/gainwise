// All dates in the app are ISO "YYYY-MM-DD" strings, which compare correctly as strings.

export const parseISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const toISO = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const todayISO = () => toISO(new Date());

export const addDays = (iso, days) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

// Calendar-month addition, clamped to the end of the month (31 Jan + 1 month = 28/29 Feb)
export const addMonths = (iso, months) => {
  const d = parseISO(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return toISO(target);
};

export const daysBetween = (fromISO, toISOStr) =>
  Math.round((parseISO(toISOStr) - parseISO(fromISO)) / 86400000);

// Indian financial year: 1 April – 31 March. Returns the starting calendar year.
export const fyOf = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return m >= 4 ? y : y - 1;
};

export const fyLabel = (start) => `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;

export const fyRange = (start) => [`${start}-04-01`, `${start + 1}-03-31`];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
};

export const monthKey = (iso) => iso.slice(0, 7);

export const formatMonth = (key) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};
