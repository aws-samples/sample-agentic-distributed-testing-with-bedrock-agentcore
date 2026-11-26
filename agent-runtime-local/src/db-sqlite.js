/**
 * Read-only SQLite for the agent's db tools (node:sqlite, Node 22.13+, no dependency).
 * node:sqlite is synchronous and cannot be interrupted, and a worker thread stuck in a native
 * query cannot be stopped either, so each query runs in a child process that is killed at the
 * timeout. The file is opened read-only and query_only is set as a second layer.
 *
 * Identical copy in agent-runtime-local/src and agent-runtime-agentcore/app/src (test/db-util.test.js).
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD = '--sqlite-child';

/** At most `limit` rows of one statement; rejects after `timeoutMs`. `file` must already be checked (resolveSqlitePath). */
export function querySqlite(file, sql, params, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [CHILD], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], env: {} });
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); child.kill('SIGKILL'); fn(v); };
    const timer = setTimeout(() => end(reject, new Error(`Query cancelled: it ran longer than ${timeoutMs / 1000}s.`)), timeoutMs);
    child.once('message', (m) => (m.error ? end(reject, new Error(m.error)) : end(resolve, m.rows)));
    child.once('error', (e) => end(reject, e));
    child.once('exit', () => end(reject, new Error('The SQLite query stopped unexpectedly.')));
    child.send({ file, sql, params, limit });
  });
}

if (process.argv[2] === CHILD && process.send) {
  process.once('message', async ({ file, sql, params, limit }) => {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      db.exec('PRAGMA query_only = ON');
      const rows = [];
      for (const r of db.prepare(sql).iterate(...(params || []))) {
        rows.push({ ...r });
        if (rows.length >= limit) break;
      }
      db.close();
      process.send({ rows }, () => process.exit(0));
    } catch (e) {
      process.send({ error: String(e?.message || e).slice(0, 300) }, () => process.exit(0));
    }
  });
}
