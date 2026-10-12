// Privacy log: records every network request the app makes (page and Python worker), so users can
// verify that their transactions never leave the browser. Uses the Resource Timing API for sizes and
// cache behaviour, plus a thin fetch wrapper that notes what each API request body contained.

const entries = [];
let snapshot = [];
const listeners = new Set();
const notes = new Map(); // url -> description of what was sent
let started = false;

const emit = () => {
  snapshot = entries.slice(); // new reference so React re-renders
  listeners.forEach((fn) => fn());
};

function categorize(url) {
  let u;
  try {
    u = new URL(url, location.href);
  } catch {
    return { group: 'other', label: 'Other' };
  }
  const host = u.hostname;
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return { group: 'api', label: 'GainWise NAV server' };
    return { group: 'app', label: 'GainWise app files' };
  }
  if (/jsdelivr\.net$/.test(host)) return { group: 'code', label: 'Python runtime (Pyodide)' };
  if (/pythonhosted\.org$|pypi\.org$/.test(host)) return { group: 'code', label: 'Python package (PyPI)' };
  if (/mfapi\.in$/.test(host)) return { group: 'data', label: 'Public NAV data (mfapi.in)' };
  if (/googleapis\.com$|gstatic\.com$/.test(host)) return { group: 'fonts', label: 'Web font (Google Fonts)' };
  if (/huggingface\.co$|hf\.co$|githubusercontent\.com$/.test(host)) return { group: 'ai', label: 'AI model files' };
  return { group: 'other', label: host };
}

function cacheStatus(e) {
  if (e.transferSize === 0 && e.decodedBodySize > 0) return 'from cache';
  // A conditional request answered 304 transfers only headers, though the body is still "used"
  if (e.transferSize > 0 && e.encodedBodySize > 0 && e.transferSize < 1200 && e.transferSize < e.encodedBodySize) return '304 revalidated';
  return 'network';
}

function add(e, source) {
  const cat = categorize(e.name);
  entries.push({
    id: entries.length,
    time: (e.timeOrigin ?? performance.timeOrigin) + e.startTime,
    url: e.name,
    source,
    ...cat,
    kind: e.initiatorType,
    status: e.responseStatus || null,
    bytes: e.transferSize || 0,
    body: e.decodedBodySize || 0,
    ms: Math.round(e.duration),
    cache: cacheStatus(e),
    sent: notes.get(e.name) ?? null,
  });
}

function describeBody(body) {
  if (typeof body !== 'string') return null;
  try {
    const json = JSON.parse(body);
    if (Array.isArray(json.names)) return `${json.names.length} fund name(s): ${json.names.join(', ')}`;
    if (Array.isArray(json.codes)) return `${json.codes.length} public scheme code(s): ${json.codes.join(', ')}`;
  } catch {
    /* not JSON */
  }
  return `${body.length} bytes`;
}

export function startNetLog() {
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;
  const po = new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => add(e, 'page'));
    emit();
  });
  po.observe({ type: 'resource', buffered: true });

  // Note what each request body carried (the timing API only knows sizes)
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
    const query = new URL(url).searchParams.get('codes') ?? new URL(url).searchParams.get('q');
    const sent = init.body ? describeBody(init.body) : query ? `query: ${decodeURIComponent(query)}` : null;
    if (sent) notes.set(url, sent);
    return original(input, init);
  };
}

// Entries observed inside the Pyodide worker (it has its own timeline)
export function addWorkerEntries(list) {
  list.forEach((e) => add(e, 'python worker'));
  emit();
}

export const getNetLog = () => snapshot;

export function subscribeNetLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
