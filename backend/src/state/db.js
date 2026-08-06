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

db.exec(`
  CREATE TABLE IF NOT EXISTS modules (
    name     TEXT PRIMARY KEY,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_cases (
    id             TEXT PRIMARY KEY,
    module         TEXT NOT NULL REFERENCES modules(name) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    title          TEXT NOT NULL,
    preconditions  TEXT NOT NULL DEFAULT '[]',
    steps          TEXT NOT NULL DEFAULT '[]',
    expectedResult TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'PENDING'
  );

  CREATE TABLE IF NOT EXISTS runs (
    runId       TEXT PRIMARY KEY,
    startedAt   TEXT NOT NULL,
    completedAt TEXT,
    stopped     INTEGER NOT NULL DEFAULT 0,
    targetUrl   TEXT,
    summary     TEXT NOT NULL DEFAULT '{}',
    modules     TEXT NOT NULL DEFAULT '{}'
  );
`);

// ── Modules & test cases ────────────────────────────────────────────────────

export function loadModulesAndCases() {
  const modules = db.prepare('SELECT name FROM modules ORDER BY position').all().map(r => r.name);
  const casesByModule = {};
  for (const m of modules) casesByModule[m] = [];
  const rows = db.prepare('SELECT * FROM test_cases ORDER BY module, position').all();
  for (const r of rows) {
    if (!casesByModule[r.module]) casesByModule[r.module] = [];
    casesByModule[r.module].push({
      id: r.id, module: r.module, title: r.title, status: r.status,
      preconditions: JSON.parse(r.preconditions),
      steps: JSON.parse(r.steps),
      expectedResult: JSON.parse(r.expectedResult),
    });
  }
  return { modules, casesByModule };
}

export function insertModule(name) {
  const { p } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM modules').get();
  db.prepare('INSERT INTO modules (name, position) VALUES (?, ?)').run(name, p);
}

export function deleteModule(name) {
  db.prepare('DELETE FROM modules WHERE name = ?').run(name);
}

export function upsertCase(tc) {
  const existing = db.prepare('SELECT position FROM test_cases WHERE id = ?').get(tc.id);
  const position = existing
    ? existing.position
    : db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM test_cases WHERE module = ?').get(tc.module).p;
  db.prepare(`
    INSERT INTO test_cases (id, module, position, title, preconditions, steps, expectedResult, status)
    VALUES (@id, @module, @position, @title, @preconditions, @steps, @expectedResult, @status)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, preconditions = excluded.preconditions,
      steps = excluded.steps, expectedResult = excluded.expectedResult, status = excluded.status
  `).run({
    id: tc.id, module: tc.module, position,
    title: tc.title, status: tc.status || 'PENDING',
    preconditions: JSON.stringify(tc.preconditions || []),
    steps: JSON.stringify(tc.steps || []),
    expectedResult: JSON.stringify(tc.expectedResult || []),
  });
}

export function deleteCase(id) {
  db.prepare('DELETE FROM test_cases WHERE id = ?').run(id);
}

// Full replace — used by /api/import (which already replaces in-memory state
// wholesale) and by the first-ever seed load. Simpler and less error-prone
// than diffing the incoming doc against existing rows.
export const replaceAllModulesAndCases = db.transaction((moduleList, testCasesByModule) => {
  db.prepare('DELETE FROM test_cases').run();
  db.prepare('DELETE FROM modules').run();
  moduleList.forEach((name, i) => {
    db.prepare('INSERT INTO modules (name, position) VALUES (?, ?)').run(name, i);
    (testCasesByModule[name] || []).forEach((tc, j) => {
      db.prepare(`
        INSERT INTO test_cases (id, module, position, title, preconditions, steps, expectedResult, status)
        VALUES (@id, @module, @position, @title, @preconditions, @steps, @expectedResult, @status)
      `).run({
        id: tc.id, module: name, position: j,
        title: tc.title, status: tc.status || 'PENDING',
        preconditions: JSON.stringify(tc.preconditions || []),
        steps: JSON.stringify(tc.steps || []),
        expectedResult: JSON.stringify(tc.expectedResult || []),
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
    summary: JSON.parse(r.summary), modules: JSON.parse(r.modules),
  }));
}

export const insertRunRecord = db.transaction((record) => {
  db.prepare(`
    INSERT INTO runs (runId, startedAt, completedAt, stopped, targetUrl, summary, modules)
    VALUES (@runId, @startedAt, @completedAt, @stopped, @targetUrl, @summary, @modules)
    ON CONFLICT(runId) DO UPDATE SET
      completedAt = excluded.completedAt, stopped = excluded.stopped,
      targetUrl = excluded.targetUrl, summary = excluded.summary, modules = excluded.modules
  `).run({
    runId: record.runId, startedAt: record.startedAt, completedAt: record.completedAt,
    stopped: record.stopped ? 1 : 0, targetUrl: record.targetUrl,
    summary: JSON.stringify(record.summary || {}), modules: JSON.stringify(record.modules || {}),
  });
  // Keep only the most recent MAX_RUNS rows, mirroring the in-memory cap.
  db.prepare(`
    DELETE FROM runs WHERE runId NOT IN (
      SELECT runId FROM runs ORDER BY startedAt DESC LIMIT ?
    )
  `).run(MAX_RUNS);
});
