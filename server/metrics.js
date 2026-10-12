// In-memory request metrics for the /status page. Records method, route, status, latency and
// bytes only: never client IPs or request bodies.

const RECENT = 25;
const SAMPLES = 2000;

export function createMetrics() {
  const started = Date.now();
  const routes = new Map();
  const status = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  const latencies = [];
  const recent = [];
  const times = []; // request timestamps for the per-minute rate
  let total = 0;
  let notModified = 0;
  let rateLimited = 0;
  let bytesSent = 0;
  let bytesBeforeGzip = 0;

  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };

  return {
    record({ method, route, path, code, ms, bytes = 0, rawBytes = bytes }) {
      total += 1;
      status[`${String(code)[0]}xx`] = (status[`${String(code)[0]}xx`] ?? 0) + 1;
      if (code === 304) notModified += 1;
      if (code === 429) rateLimited += 1;
      bytesSent += bytes;
      bytesBeforeGzip += rawBytes;
      latencies.push(ms);
      if (latencies.length > SAMPLES) latencies.shift();
      const now = Date.now();
      times.push(now);
      while (times.length && times[0] < now - 60_000) times.shift();
      const r = routes.get(route) ?? { route, count: 0, errors: 0, totalMs: 0, samples: [] };
      r.count += 1;
      r.totalMs += ms;
      if (code >= 500) r.errors += 1;
      r.samples.push(ms);
      if (r.samples.length > 500) r.samples.shift();
      routes.set(route, r);
      recent.unshift({ at: new Date(now).toISOString(), method, path, code, ms: Math.round(ms * 10) / 10, bytes });
      if (recent.length > RECENT) recent.pop();
    },
    snapshot() {
      return {
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
        requests: total,
        perMinute: times.length,
        status,
        notModified,
        rateLimited,
        bytesSent,
        gzipSavedPct: bytesBeforeGzip ? Math.round((1 - bytesSent / bytesBeforeGzip) * 1000) / 10 : 0,
        latencyMs: { p50: Math.round(pct(latencies, 50) * 10) / 10, p95: Math.round(pct(latencies, 95) * 10) / 10 },
        routes: [...routes.values()]
          .map((r) => ({ route: r.route, count: r.count, errors: r.errors, avgMs: Math.round((r.totalMs / r.count) * 10) / 10, p95Ms: Math.round(pct(r.samples, 95) * 10) / 10 }))
          .sort((a, b) => b.count - a.count),
        recent,
      };
    },
  };
}
