/**
 * In-memory archive of completed test runs, capped at 50.
 * Most recent run is first.
 */

export const runArchive = [];

export function saveRunRecord(record) {
  runArchive.unshift(record);
  if (runArchive.length > 50) runArchive.pop();
}
