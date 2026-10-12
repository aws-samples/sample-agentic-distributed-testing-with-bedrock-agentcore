/**
 * SQLite persistence for data that used to live only in process memory:
 * test case definitions (Editor page) and the run archive (Analysis page).
 * store.js/archive.js hydrate their in-memory arrays/objects from here on
 * boot, then call back into these helpers on every mutation.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.SQLITE_DB_PATH || path.join(__dirname, 'data.db');

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── One-time migration: modules → features (before the CREATEs below) ───────
// Databases created before the rename have `modules`, test_cases.module and
// runs.modules. Take a consistent backup next to the DB first, then rename in
// place — row data is untouched.
function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}
if (tableExists('modules') && !tableExists('features')) {
  const backup = DB_FILE.replace(/\.db$/, '') + `.pre-feature-rename-${Date.now()}.db`;
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`[db] backed up to ${backup}`);
  db.pragma('foreign_keys = OFF');           // no-op inside a transaction, so set it first
  db.transaction(() => {
    db.exec('ALTER TABLE modules RENAME TO features');   // also rewrites test_cases' FK reference
    if (tableExists('test_cases')) db.exec('ALTER TABLE test_cases RENAME COLUMN module TO feature');
    if (tableExists('runs')) db.exec('ALTER TABLE runs RENAME COLUMN modules TO features');
  })();
  db.pragma('foreign_keys = ON');
  console.log('[db] migrated modules -> features');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS features (
    name        TEXT PRIMARY KEY,
    position    INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT ''   -- the Feature's Background (shared setup)
  );

  CREATE TABLE IF NOT EXISTS test_cases (
    id             TEXT PRIMARY KEY,
    feature        TEXT NOT NULL REFERENCES features(name) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    title          TEXT NOT NULL,
    "given"        TEXT NOT NULL DEFAULT '[]',
    "when"         TEXT NOT NULL DEFAULT '[]',
    "then"         TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'PENDING'
  );

  CREATE TABLE IF NOT EXISTS runs (
    runId       TEXT PRIMARY KEY,
    startedAt   TEXT NOT NULL,
    completedAt TEXT,
    stopped     INTEGER NOT NULL DEFAULT 0,
    targetUrl   TEXT,
    summary     TEXT NOT NULL DEFAULT '{}',
    features    TEXT NOT NULL DEFAULT '{}'
  );
`);

// One-time migration for databases created before the AI-enhanced BDD rename
// (preconditions/steps/expectedResult → given/when/then). Data is untouched.
// "when" and "then" are SQL keywords, hence the quoting everywhere.
{
  const cols = db.prepare('PRAGMA table_info(test_cases)').all().map(c => c.name);
  if (cols.includes('preconditions')) {
    db.exec(`
      ALTER TABLE test_cases RENAME COLUMN preconditions  TO "given";
      ALTER TABLE test_cases RENAME COLUMN steps          TO "when";
      ALTER TABLE test_cases RENAME COLUMN expectedResult TO "then";
    `);
    console.log('[db] migrated test_cases columns to given/when/then');
  }
}

// The Feature description (its Background) was added after the first release.
{
  const cols = db.prepare('PRAGMA table_info(features)').all().map(c => c.name);
  if (!cols.includes('description')) {
    db.exec("ALTER TABLE features ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
}

// Test case ids used to be prefixed with the feature number (MD001-TC001), which
// ties an id to a feature and collides once cases move. They are now plain
// TC001, TC002, ... numbered across the whole suite. Renumber in the order the
// cases appear and remember old -> new so stored results can follow.
db.exec('CREATE TABLE IF NOT EXISTS tc_id_map (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL)');
{
  const legacy = db.prepare(`
    SELECT t.id FROM test_cases t LEFT JOIN features f ON f.name = t.feature
    WHERE t.id GLOB 'MD[0-9]*-TC[0-9]*' ORDER BY f.position, t.position
  `).all().map(r => r.id);
  if (legacy.length) {
    let n = 0;
    for (const { id } of db.prepare("SELECT id FROM test_cases WHERE id GLOB 'TC[0-9]*'").all()) {
      n = Math.max(n, parseInt(id.slice(2), 10) || 0);
    }
    const setId = db.prepare('UPDATE test_cases SET id = ? WHERE id = ?');
    const remember = db.prepare('INSERT OR REPLACE INTO tc_id_map (old_id, new_id) VALUES (?, ?)');
    db.transaction(() => {
      for (const oldId of legacy) {
        const newId = 'TC' + String(++n).padStart(3, '0');
        setId.run(newId, oldId);
        remember.run(oldId, newId);
      }
    })();
    console.log(`[db] renumbered ${legacy.length} test case ids (MD001-TC001 -> TC001, ...)`);
  }
}

/** { 'MD001-TC001': 'TC001', ... } — lets stored results keyed by old ids follow the rename. */
export function loadLegacyIdMap() {
  return Object.fromEntries(db.prepare('SELECT old_id, new_id FROM tc_id_map').all().map(r => [r.old_id, r.new_id]));
}

// ── Features & test cases ────────────────────────────────────────────────────

export function loadFeaturesAndCases() {
  const featureRows = db.prepare('SELECT name, description FROM features ORDER BY position').all();
  const features = featureRows.map(r => r.name);
  const descriptions = Object.fromEntries(featureRows.map(r => [r.name, r.description || '']));
  const casesByFeature = {};
  for (const m of features) casesByFeature[m] = [];
  const rows = db.prepare('SELECT * FROM test_cases ORDER BY feature, position').all();
  for (const r of rows) {
    if (!casesByFeature[r.feature]) casesByFeature[r.feature] = [];
    casesByFeature[r.feature].push({
      id: r.id, feature: r.feature, title: r.title, status: r.status,
      given: JSON.parse(r.given),
      when: JSON.parse(r.when),
      then: JSON.parse(r.then),
    });
  }
  return { features, casesByFeature, descriptions };
}

export function insertFeature(name, description = '') {
  const { p } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM features').get();
  db.prepare('INSERT INTO features (name, position, description) VALUES (?, ?, ?)').run(name, p, description);
}

export function deleteFeature(name) {
  db.prepare('DELETE FROM features WHERE name = ?').run(name);
}

export function upsertCase(tc) {
  const existing = db.prepare('SELECT position FROM test_cases WHERE id = ?').get(tc.id);
  const position = existing
    ? existing.position
    : db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM test_cases WHERE feature = ?').get(tc.feature).p;
  db.prepare(`
    INSERT INTO test_cases (id, feature, position, title, "given", "when", "then", status)
    VALUES (@id, @feature, @position, @title, @given, @when, @then, @status)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, "given" = excluded."given",
      "when" = excluded."when", "then" = excluded."then", status = excluded.status
  `).run({
    id: tc.id, feature: tc.feature, position,
    title: tc.title, status: tc.status || 'PENDING',
    given: JSON.stringify(tc.given || []),
    when: JSON.stringify(tc.when || []),
    then: JSON.stringify(tc.then || []),
  });
}

export function deleteCase(id) {
  db.prepare('DELETE FROM test_cases WHERE id = ?').run(id);
}

// Full replace — used by /api/import (which already replaces in-memory state
// wholesale) and by the first-ever seed load. Simpler and less error-prone
// than diffing the incoming doc against existing rows.
export const replaceAllFeaturesAndCases = db.transaction((featureList, testCasesByFeature, descriptions = {}) => {
  db.prepare('DELETE FROM test_cases').run();
  db.prepare('DELETE FROM features').run();
  featureList.forEach((name, i) => {
    db.prepare('INSERT INTO features (name, position, description) VALUES (?, ?, ?)').run(name, i, descriptions[name] || '');
    (testCasesByFeature[name] || []).forEach((tc, j) => {
      db.prepare(`
        INSERT INTO test_cases (id, feature, position, title, "given", "when", "then", status)
        VALUES (@id, @feature, @position, @title, @given, @when, @then, @status)
      `).run({
        id: tc.id, feature: name, position: j,
        title: tc.title, status: tc.status || 'PENDING',
        given: JSON.stringify(tc.given || []),
        when: JSON.stringify(tc.when || []),
        then: JSON.stringify(tc.then || []),
      });
    });
  });
});

// ── Run archive ─────────────────────────────────────────────────────────────

const MAX_RUNS = 50;

export function loadRunArchive() {
  const rows = db.prepare('SELECT * FROM runs ORDER BY startedAt DESC LIMIT ?').all(MAX_RUNS);
  return rows.map(r => ({
    runId: r.runId, startedAt: r.startedAt, completedAt: r.completedAt,
    stopped: !!r.stopped, targetUrl: r.targetUrl,
    summary: JSON.parse(r.summary), features: JSON.parse(r.features),
  }));
}

export const insertRunRecord = db.transaction((record) => {
  db.prepare(`
    INSERT INTO runs (runId, startedAt, completedAt, stopped, targetUrl, summary, features)
    VALUES (@runId, @startedAt, @completedAt, @stopped, @targetUrl, @summary, @features)
    ON CONFLICT(runId) DO UPDATE SET
      completedAt = excluded.completedAt, stopped = excluded.stopped,
      targetUrl = excluded.targetUrl, summary = excluded.summary, features = excluded.features
  `).run({
    runId: record.runId, startedAt: record.startedAt, completedAt: record.completedAt,
    stopped: record.stopped ? 1 : 0, targetUrl: record.targetUrl,
    summary: JSON.stringify(record.summary || {}), features: JSON.stringify(record.features || {}),
  });
  // Keep only the most recent MAX_RUNS rows, mirroring the in-memory cap.
  db.prepare(`
    DELETE FROM runs WHERE runId NOT IN (
      SELECT runId FROM runs ORDER BY startedAt DESC LIMIT ?
    )
  `).run(MAX_RUNS);
});
