// Small per-browser preferences (theme, slab, fund classes, scheme matches).
// Transactions are never stored. Every access is guarded: storage can be blocked.
import { useEffect, useState } from 'react';

const PREFIX = 'gainwise:';
const LEGACY_PREFIX = 'zbtc:'; // before the rename to GainWise

export function load(key, fallback) {
  try {
    let raw = localStorage.getItem(PREFIX + key);
    if (raw == null) {
      raw = localStorage.getItem(LEGACY_PREFIX + key);
      if (raw != null) {
        localStorage.setItem(PREFIX + key, raw);
        localStorage.removeItem(LEGACY_PREFIX + key);
      }
    }
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Keys from earlier versions that should no longer influence anything
try {
  localStorage.removeItem(`${PREFIX}schemeCodes`); // auto-matched codes used to be cached here
  localStorage.removeItem('zbtc:schemeCodes');
} catch {
  /* storage unavailable */
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}

export function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => load(key, fallback));
  useEffect(() => save(key, value), [key, value]);
  return [value, setValue];
}
