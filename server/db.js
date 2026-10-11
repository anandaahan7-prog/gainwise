// SQLite store for public AMFI data (schemes, latest NAVs, NAV history). No user data lives here.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS schemes (
      code        INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      amc         TEXT,
      category    TEXT,
      plan        TEXT,
      option      TEXT,
      isin_growth TEXT,
      isin_reinv  TEXT,
      nav         REAL,
      nav_date    TEXT,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nav_history (
      code INTEGER NOT NULL,
      date TEXT NOT NULL,
      nav  REAL NOT NULL,
      PRIMARY KEY (code, date)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS history_sync (
      code       INTEGER PRIMARY KEY,
      fetched_at TEXT NOT NULL
    );
    -- From AMFI's scheme master: the full "NAV name" (incl. plan/option, which NAVAll often leaves blank)
    CREATE TABLE IF NOT EXISTS scheme_names (
      code     INTEGER PRIMARY KEY,
      nav_name TEXT NOT NULL,
      category TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const stmts = {
    upsertScheme: db.prepare(`
      INSERT INTO schemes (code, name, amc, category, plan, option, isin_growth, isin_reinv, nav, nav_date, updated_at)
      VALUES (:code, :name, :amc, :category, :plan, :option, :isin_growth, :isin_reinv, :nav, :nav_date, :updated_at)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name, amc = excluded.amc, category = excluded.category, plan = excluded.plan,
        option = excluded.option, isin_growth = excluded.isin_growth, isin_reinv = excluded.isin_reinv,
        nav = excluded.nav, nav_date = excluded.nav_date, updated_at = excluded.updated_at`),
    upsertHistory: db.prepare('INSERT OR REPLACE INTO nav_history (code, date, nav) VALUES (?, ?, ?)'),
    upsertName: db.prepare('INSERT OR REPLACE INTO scheme_names (code, nav_name, category) VALUES (?, ?, ?)'),
    scheme: db.prepare(`SELECT s.*, n.nav_name, COALESCE(s.category, n.category) AS category
                        FROM schemes s LEFT JOIN scheme_names n USING (code) WHERE s.code = ?`),
    allSchemes: db.prepare(`SELECT s.code, s.name, s.amc, COALESCE(s.category, n.category) AS category, s.plan, s.option,
                              s.isin_growth, s.nav, s.nav_date, n.nav_name
                            FROM schemes s LEFT JOIN scheme_names n USING (code)`),
    countSchemes: db.prepare('SELECT COUNT(*) AS n FROM schemes'),
    // Liquid/overnight funds publish weekend NAVs ahead of time, so report the date most schemes share
    commonNavDate: db.prepare('SELECT nav_date FROM schemes WHERE nav_date IS NOT NULL GROUP BY nav_date ORDER BY COUNT(*) DESC LIMIT 1'),
    navOnOrBefore: db.prepare('SELECT date, nav FROM nav_history WHERE code = ? AND date <= ? ORDER BY date DESC LIMIT 1'),
    historyRange: db.prepare('SELECT date, nav FROM nav_history WHERE code = ? AND date BETWEEN ? AND ? ORDER BY date'),
    historySyncedAt: db.prepare('SELECT fetched_at FROM history_sync WHERE code = ?'),
    markHistorySynced: db.prepare('INSERT OR REPLACE INTO history_sync (code, fetched_at) VALUES (?, ?)'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
  };

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  return {
    raw: db,
    tx,
    upsertSchemes: (rows) => tx(() => rows.forEach((r) => stmts.upsertScheme.run(r))),
    upsertHistory: (rows) => tx(() => rows.forEach((r) => stmts.upsertHistory.run(r.code, r.date, r.nav))),
    upsertNames: (rows) => tx(() => rows.forEach((r) => stmts.upsertName.run(r.code, r.navName, r.category))),
    scheme: (code) => stmts.scheme.get(code) ?? null,
    allSchemes: () => stmts.allSchemes.all(),
    stats: () => ({ n: stmts.countSchemes.get().n, latest: stmts.commonNavDate.get()?.nav_date ?? null }),
    navOnOrBefore: (code, date) => stmts.navOnOrBefore.get(code, date) ?? null,
    historyRange: (code, from, to) => stmts.historyRange.all(code, from, to),
    historySyncedAt: (code) => stmts.historySyncedAt.get(code)?.fetched_at ?? null,
    markHistorySynced: (code, at) => stmts.markHistorySynced.run(code, at),
    getMeta: (key) => stmts.getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => stmts.setMeta.run(key, value == null ? null : String(value)),
    close: () => db.close(),
  };
}
