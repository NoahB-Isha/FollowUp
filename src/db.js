import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.js';

export const db = new DatabaseSync(paths.db);

// WAL + relaxed sync (safe with WAL: worst case on power loss is the last
// transaction, which a re-sync recreates), memory temp tables, bigger page
// cache, and mmap'd reads — standard SQLite fast-path for a read-heavy app.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -8192;      -- 8 MB page cache
  PRAGMA mmap_size = 134217728;   -- 128 MB mmap window
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS walkthroughs (
    id            TEXT PRIMARY KEY,          -- JotForm submission id
    submitted_at  TEXT NOT NULL,             -- when the form was submitted
    walk_date     TEXT NOT NULL,             -- date the coordinator reported walking (YYYY-MM-DD)
    coordinator   TEXT NOT NULL,
    lodge         TEXT NOT NULL,
    floor         TEXT NOT NULL,
    comments      TEXT,
    raw_json      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS area_reports (
    id             INTEGER PRIMARY KEY,
    walkthrough_id TEXT NOT NULL REFERENCES walkthroughs(id) ON DELETE CASCADE,
    area           TEXT NOT NULL,            -- 'Wing A' … 'Wing H', or section name
    kind           TEXT NOT NULL,            -- 'wing' | 'section'
    statuses_json  TEXT NOT NULL,            -- checked options, JSON array
    note           TEXT,                     -- free-text 'other'
    skipped        INTEGER NOT NULL DEFAULT 0 -- non-dorm / locked / N/A
  );

  CREATE TABLE IF NOT EXISTS photos (
    id             INTEGER PRIMARY KEY,
    walkthrough_id TEXT NOT NULL REFERENCES walkthroughs(id) ON DELETE CASCADE,
    url            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id          INTEGER PRIMARY KEY,
    lodge       TEXT NOT NULL,
    floor       TEXT NOT NULL,
    area        TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL,               -- housekeeping | maintenance | supplies | other
    severity    TEXT NOT NULL DEFAULT 'normal', -- normal | high
    status      TEXT NOT NULL DEFAULT 'open',   -- open | resolved | dismissed
    assignee    TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1,
    resolved_at TEXT,
    resolved_by TEXT,
    norm_key    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issue_sightings (
    id             INTEGER PRIMARY KEY,
    issue_id       INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    walkthrough_id TEXT NOT NULL REFERENCES walkthroughs(id) ON DELETE CASCADE,
    seen_date      TEXT NOT NULL,
    text           TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

  CREATE INDEX IF NOT EXISTS idx_issues_open      ON issues(status, lodge, area);
  CREATE INDEX IF NOT EXISTS idx_issues_sev       ON issues(status, severity);
  CREATE INDEX IF NOT EXISTS idx_walks_date       ON walkthroughs(walk_date);
  CREATE INDEX IF NOT EXISTS idx_walks_unit       ON walkthroughs(lodge, floor, walk_date);
  CREATE INDEX IF NOT EXISTS idx_sightings        ON issue_sightings(issue_id);
  CREATE INDEX IF NOT EXISTS idx_sightings_walk   ON issue_sightings(walkthrough_id);
  CREATE INDEX IF NOT EXISTS idx_photos_walk      ON photos(walkthrough_id);
`);

// Prepared-statement cache: preparing is pure overhead when the same SQL runs
// on every request. All hot paths go through q().
const stmts = new Map();
export function q(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
}

export function hasWalkthrough(id) {
  return !!q('SELECT 1 FROM walkthroughs WHERE id = ?').get(id);
}

/**
 * Monotonic data version, bumped on every write. Response caches key on it so
 * a change (sync, resolve, assign) invalidates instantly — even from another
 * process, since it lives in the DB.
 */
export function dataVersion() {
  return q(`SELECT v FROM meta WHERE k = 'data_version'`).get()?.v ?? '0';
}

export function bumpDataVersion() {
  q(`INSERT INTO meta (k, v) VALUES ('data_version', '1')
     ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1`).run();
}

export function getMeta(key) {
  return q('SELECT v FROM meta WHERE k = ?').get(key)?.v ?? null;
}

export function setMeta(key, value) {
  q('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, value);
}

/** Run fn inside a single transaction — turns N fsyncs into 1 during sync. */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
