/**
 * Archive of completed test runs, capped at 50, persisted to SQLite
 * (backend/src/state/data.db) so the Analysis page survives backend
 * restarts. Most recent run is first.
 */

import { loadRunArchive, insertRunRecord } from './db.js';

export const runArchive = loadRunArchive();

export function saveRunRecord(record) {
  runArchive.unshift(record);
  if (runArchive.length > 50) runArchive.pop();
  insertRunRecord(record);
}
