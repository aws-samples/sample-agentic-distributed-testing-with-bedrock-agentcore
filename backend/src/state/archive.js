/**
 * Archive of completed test runs, capped at 50, persisted to SQLite
 * (backend/src/state/data.db) so the Analysis page survives backend
 * restarts. Most recent run is first.
 */

import { loadRunArchive, insertRunRecord } from './db.js';

export const runArchive = loadRunArchive();

// Saves or updates a run record — used both for the run's initial
// (in-progress, completedAt null) snapshot and every update after, so
// Analysis reflects a run live instead of only once it finishes.
// insertRunRecord's SQL is already an upsert (ON CONFLICT runId), so this
// only needs to fix up the in-memory copy alongside it.
export function upsertRunRecord(record) {
  const idx = runArchive.findIndex(r => r.runId === record.runId);
  if (idx === -1) runArchive.unshift(record);
  else runArchive[idx] = record;
  if (runArchive.length > 50) runArchive.pop();
  insertRunRecord(record);
}
