// Data operations behind the HTTP API: keeping NAVs fresh, matching names, serving history.
import { fetchNavAll, fetchNavsOnDate, fetchSchemeHistory, fetchSchemeMaster } from './amfi.js';
import { buildIndex, matchName, publicScheme } from './match.js';

export const GRANDFATHER_DATE = '2018-01-31'; // Sec 112A: FMV on 31 Jan 2018 caps the taxable gain on older units

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function createService(db, { log = console.log, historyTtlHours = 12 } = {}) {
  let index = buildIndex(db.allSchemes());
  let refreshing = null;

  const status = () => {
    const s = db.stats();
    return {
      schemes: s.n,
      latestNavDate: s.latest,
      lastRefresh: db.getMeta('last_refresh'),
      lastRefreshError: db.getMeta('last_refresh_error'),
      fmv2018Loaded: db.getMeta('fmv2018_loaded') === '1',
    };
  };

  /** Pull NAVAll.txt (conditional GET, so an unchanged file costs one tiny 304 response). */
  function refreshLatest() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const started = Date.now();
      try {
        const result = await fetchNavAll({ etag: db.getMeta('navall_etag'), lastModified: db.getMeta('navall_last_modified') });
        if (result.notModified) {
          log(`[refresh] NAVAll unchanged (304) in ${Date.now() - started} ms`);
        } else {
          db.upsertSchemes(result.rows);
          db.setMeta('navall_etag', result.etag);
          db.setMeta('navall_last_modified', result.lastModified);
          index = buildIndex(db.allSchemes());
          log(`[refresh] loaded ${result.rows.length} schemes in ${Date.now() - started} ms`);
        }
        db.setMeta('last_refresh', new Date().toISOString());
        db.setMeta('last_refresh_error', null);
      } catch (e) {
        db.setMeta('last_refresh_error', e.message);
        log(`[refresh] failed: ${e.message}`);
        throw e;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** Daily: full scheme names with plan/option (NAVAll leaves those blank for ~40% of schemes). */
  async function refreshMaster() {
    const last = db.getMeta('master_refresh');
    if (last && Date.now() - Date.parse(last) < 24 * 3_600_000) return;
    const started = Date.now();
    const rows = await fetchSchemeMaster();
    db.upsertNames(rows);
    db.setMeta('master_refresh', new Date().toISOString());
    index = buildIndex(db.allSchemes());
    log(`[master] stored ${rows.length} scheme names in ${Date.now() - started} ms`);
  }

  /** One-time load of every scheme's NAV on 31 Jan 2018 (a single ~1 MB AMFI report). */
  async function ensureFmv2018() {
    if (db.getMeta('fmv2018_loaded') === '1') return;
    const rows = await fetchNavsOnDate(GRANDFATHER_DATE);
    db.upsertHistory(rows);
    db.setMeta('fmv2018_loaded', '1');
    log(`[fmv2018] stored ${rows.length} NAVs for ${GRANDFATHER_DATE}`);
  }

  /** Make sure we hold a recent copy of one scheme's full history (from mfapi.in). */
  async function syncHistory(code) {
    const at = db.historySyncedAt(code);
    if (at && (Date.now() - Date.parse(at)) / 3_600_000 < historyTtlHours) return;
    const rows = await fetchSchemeHistory(code);
    db.upsertHistory(rows);
    db.markHistorySynced(code, new Date().toISOString());
  }

  async function navOn(code, iso) {
    let row = db.navOnOrBefore(code, iso);
    // NAVs aren't published on holidays; accept the previous business day within a week
    if (!row || daysBetween(row.date, iso) > 7) {
      await syncHistory(code);
      row = db.navOnOrBefore(code, iso);
    }
    return row && daysBetween(row.date, iso) <= 7 ? row : null;
  }

  return {
    status,
    refreshLatest,
    refreshMaster,
    ensureFmv2018,
    hasData: () => index.entries.length > 0,
    search: (q, limit) => matchName(index, q, { limit }).alternatives,
    match: (names) => Object.fromEntries(names.map((n) => [n, matchName(index, n)])),
    latest: (codes) =>
      Object.fromEntries(codes.map((c) => {
        const s = db.scheme(c);
        return [c, s ? publicScheme(s) : null];
      })),
    scheme: (code) => {
      const s = db.scheme(code);
      return s ? publicScheme(s) : null;
    },
    navOn,
    async history(code, from, to) {
      await syncHistory(code);
      return db.historyRange(code, from, to);
    },
    async fmv2018(codes) {
      await ensureFmv2018().catch((e) => log(`[fmv2018] ${e.message}`));
      const out = {};
      for (const c of codes) out[c] = await navOn(c, GRANDFATHER_DATE).catch(() => null);
      return out;
    },
  };
}
