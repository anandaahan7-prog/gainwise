// GainWise NAV cache server — a small, dependency-free HTTP API over public AMFI data.
// Privacy: requests contain only fund names/scheme codes (public information). Request bodies are
// never logged or stored, and nothing about the user's holdings is ever sent here.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { openDb } from './db.js';
import { createService } from './service.js';

const config = {
  port: Number(process.env.PORT ?? 8787),
  dbFile: process.env.DB_FILE ?? fileURLToPath(new URL('./data/navs.db', import.meta.url)),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  refreshMinutes: Number(process.env.REFRESH_MINUTES ?? 60),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  trustProxy: process.env.TRUST_PROXY === '1',
  // In production the same process can serve the built app (npm run build -> dist/)
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url)),
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
  return allowed ? { 'Access-Control-Allow-Origin': config.allowedOrigins.includes('*') ? '*' : origin, Vary: 'Origin' } : {};
}

function send(req, res, status, data, { maxAge = 0 } = {}) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
  };
  if (status === 200 && req.method === 'GET') {
    // Conditional requests: identical responses cost the client only a 304
    const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
  }
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    body = gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function readJson(req, limit = 64 * 1024) {
  if (!/application\/json/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send a JSON body (Content-Type: application/json)');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

// Token bucket per client IP: smooth bursts, cap sustained load
const buckets = new Map();
function rateLimit(req) {
  const ip = (config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
  const capacity = config.rateLimitPerMinute;
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * capacity);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    throw new HttpError(429, 'Too many requests', { 'Retry-After': String(Math.ceil(((1 - b.tokens) * 60) / capacity)) });
  }
  b.tokens -= 1;
  buckets.set(ip, b);
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const codeParam = (s) => {
  const c = Number(s);
  if (!Number.isInteger(c) || c <= 0) throw new HttpError(400, 'Invalid scheme code');
  return c;
};
const codesBody = (body, max = 100) => {
  if (!Array.isArray(body.codes) || !body.codes.length || body.codes.length > max) throw new HttpError(400, `Send "codes": an array of 1-${max} scheme codes`);
  return body.codes.map(codeParam);
};
const namesBody = (body, max = 50) => {
  const ok = Array.isArray(body.names) && body.names.length > 0 && body.names.length <= max && body.names.every((n) => typeof n === 'string' && n.trim() && n.length <= 200);
  if (!ok) throw new HttpError(400, `Send "names": an array of 1-${max} fund names`);
  return body.names.map((n) => n.trim());
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const db = openDb(config.dbFile);
const service = createService(db, { log });
const startedAt = Date.now();

const requireData = () => {
  if (!service.hasData()) throw new HttpError(503, 'NAV data is still loading, retry shortly', { 'Retry-After': '10' });
};

const routes = [
  ['GET', /^\/api\/health$/, () => [200, { ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), ...service.status() }]],
  ['GET', /^\/api\/schemes\/search$/, (req, url) => {
    requireData();
    const q = url.searchParams.get('q')?.trim();
    if (!q || q.length < 2) throw new HttpError(400, 'Query "q" must be at least 2 characters');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 10) || 10, 25);
    return [200, { results: service.search(q, limit) }, 300];
  }],
  ['POST', /^\/api\/match$/, async (req) => {
    requireData();
    return [200, { results: service.match(namesBody(await readJson(req))) }];
  }],
  ['POST', /^\/api\/navs$/, async (req) => {
    requireData();
    return [200, { navs: service.latest(codesBody(await readJson(req))) }];
  }],
  ['POST', /^\/api\/fmv2018$/, async (req) => [200, { date: '2018-01-31', fmv: await service.fmv2018(codesBody(await readJson(req), 50)) }]],
  ['GET', /^\/api\/schemes\/(\d+)$/, (req, url, [, code]) => {
    requireData();
    const s = service.scheme(codeParam(code));
    if (!s) throw new HttpError(404, 'Unknown scheme code');
    return [200, s, 300];
  }],
  ['GET', /^\/api\/schemes\/(\d+)\/nav$/, async (req, url, [, code]) => {
    const date = url.searchParams.get('date');
    if (!ISO.test(date ?? '')) throw new HttpError(400, 'Query "date" must be YYYY-MM-DD');
    const row = await service.navOn(codeParam(code), date);
    if (!row) throw new HttpError(404, 'No NAV published within a week before that date');
    return [200, { code: Number(code), requested: date, ...row }, 3600];
  }],
  ['GET', /^\/api\/schemes\/(\d+)\/history$/, async (req, url, [, code]) => {
    const from = url.searchParams.get('from') ?? '1990-01-01';
    const to = url.searchParams.get('to') ?? '2999-12-31';
    if (!ISO.test(from) || !ISO.test(to)) throw new HttpError(400, '"from" and "to" must be YYYY-MM-DD');
    return [200, { code: Number(code), data: await service.history(codeParam(code), from, to) }, 3600];
  }],
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** Serve dist/ for non-API paths (SPA fallback to index.html). Returns false if there's no build. */
function serveStatic(req, res, pathname) {
  if (!existsSync(config.staticDir)) return false;
  const root = normalize(config.staticDir);
  let file = normalize(join(root, decodeURIComponent(pathname)));
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(403, 'Forbidden'); // path traversal
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const body = readFileSync(file);
  const hashed = /[\\/]assets[\\/]/.test(file); // Vite fingerprints these, so they can be cached forever
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

const server = createServer(async (req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url, 'http://localhost');
  let status = 500;
  try {
    if (!url.pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
      if (serveStatic(req, res, url.pathname)) {
        status = 200;
        return;
      }
    }
    if (req.method === 'OPTIONS') {
      status = 204;
      res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
      return res.end();
    }
    rateLimit(req);
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const pathRoutes = routes.filter(([, re]) => re.test(url.pathname));
    if (!pathRoutes.length) throw new HttpError(404, 'Not found');
    const route = pathRoutes.find(([m]) => m === method);
    if (!route) throw new HttpError(405, 'Method not allowed', { Allow: pathRoutes.map(([m]) => m).join(', ') });
    const [s, data, maxAge] = await route[2](req, url, url.pathname.match(route[1]));
    status = s;
    send(req, res, s, data, { maxAge });
  } catch (e) {
    status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log('[error]', e);
    for (const [k, v] of Object.entries(e.headers ?? {})) res.setHeader(k, v);
    send(req, res, status, { error: status === 500 ? 'Internal server error' : e.message });
  } finally {
    // Path and status only — never bodies (they contain fund names) or client IPs
    log(`${req.method} ${url.pathname} ${status} ${(performance.now() - t0).toFixed(1)}ms`);
  }
});

async function refreshLoop() {
  try {
    await service.refreshLatest();
    service.refreshMaster().catch((e) => log(`[master] ${e.message}`));
    service.ensureFmv2018().catch((e) => log(`[fmv2018] ${e.message}`));
  } catch {
    /* logged in service; retry on next tick */
  }
}

server.listen(config.port, () => {
  log(`GainWise NAV server on http://localhost:${config.port} (db: ${config.dbFile})`);
  const last = db.getMeta('last_refresh');
  const stale = !last || Date.now() - Date.parse(last) > config.refreshMinutes * 60_000 || !service.hasData();
  if (stale) refreshLoop();
  else {
    // Fresh NAVs, but the daily scheme master and one-time FMV load have their own schedules
    service.refreshMaster().catch((e) => log(`[master] ${e.message}`));
    service.ensureFmv2018().catch((e) => log(`[fmv2018] ${e.message}`));
  }
  setInterval(refreshLoop, config.refreshMinutes * 60_000).unref();
});

const shutdown = (sig) => {
  log(`${sig} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
