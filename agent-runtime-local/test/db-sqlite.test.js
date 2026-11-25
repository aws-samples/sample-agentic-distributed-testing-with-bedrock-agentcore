// Read-only SQLite connection: no external database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'sqlitetest-')));
const allowed = join(root, 'allowed'); const other = join(root, 'other');
mkdirSync(allowed); mkdirSync(other);
for (const f of [join(allowed, 'carddemo.db'), join(other, 'secret.db')]) {
  const d = new DatabaseSync(f);
  d.exec("CREATE TABLE accounts (account_id TEXT PRIMARY KEY, balance REAL); INSERT INTO accounts VALUES ('A1', 10.5), ('A2', 20)");
  d.close();
}
symlinkSync(join(other, 'secret.db'), join(allowed, 'link.db'));
process.env.DB_SQLITE_DIRS = allowed;
process.env.DB_TIMEOUT_MS = '1500';
const conn = (name, database) => ({ name, type: 'sqlite', database });
const creds = join(root, 'c.json');
writeFileSync(creds, JSON.stringify([conn('demo', join(allowed, 'carddemo.db')), conn('outside', join(other, 'secret.db')),
  conn('link', join(allowed, 'link.db')), conn('dots', join(allowed, '..', 'other', 'secret.db')), conn('missing', join(allowed, 'nope.db'))]));
process.env.DB_CONNECTIONS_FILE = creds;
const { callTool } = await import('../src/db-server.js');
const q = (connection, sql) => callTool('query', { connection, sql });

test('answers a real query, tables and columns', async () => {
  assert.deepEqual((await q('demo', 'SELECT account_id, balance FROM accounts ORDER BY 1')).rows, [{ account_id: 'A1', balance: 10.5 }, { account_id: 'A2', balance: 20 }]);
  assert.deepEqual((await callTool('list_tables', { connection: 'demo' })).rows.map(r => r.table), ['accounts']);
  const d = await callTool('describe_table', { connection: 'demo', table: 'accounts' });
  assert.deepEqual(d.columns.map(c => c.name), ['account_id', 'balance']);
  await assert.rejects(callTool('describe_table', { connection: 'demo', table: 'nope' }), /No table named/);
});

test('refuses writes, ATTACH, PRAGMA, extensions and several statements', async () => {
  for (const sql of [
    "INSERT INTO accounts VALUES ('A3', 1)", 'UPDATE accounts SET balance = 0', 'DELETE FROM accounts', 'DROP TABLE accounts',
    'CREATE TABLE t (x)', "ATTACH DATABASE '/etc/passwd' AS p", 'attach database ":memory:" as m', 'PRAGMA query_only = OFF',
    'pragma writable_schema = 1', 'SELECT * FROM pragma_table_info(\'accounts\')', "SELECT load_extension('/tmp/x.so')",
    'VACUUM', 'REINDEX', 'SELECT 1; DELETE FROM accounts', "SELECT writefile('/tmp/x', 'y')", 'SELECT "load_extension"(\'x\')', 'SELECT [load_extension](\'x\')',
    '/* c */ ATTACH DATABASE \'x\' AS y', 'BEGIN', 'REPLACE INTO accounts VALUES (\'A1\', 0)',
  ]) await assert.rejects(q('demo', sql), /Read-only connection|Only one statement/, sql);
  assert.equal((await q('demo', 'SELECT COUNT(*) AS n FROM accounts')).rows[0].n, 2);
});

test('the database itself refuses a write that skips the statement check', async () => {
  const { querySqlite } = await import('../src/db-sqlite.js');
  await assert.rejects(querySqlite(join(allowed, 'carddemo.db'), 'DELETE FROM accounts', [], 10, 1500), /readonly|read-only/i);
});

test('refuses files outside the allowed directory, links out of it, ".." and missing files', async () => {
  await assert.rejects(q('outside', 'SELECT 1'), /must be inside/);
  await assert.rejects(q('link', 'SELECT 1'), /must be inside/);
  await assert.rejects(q('dots', 'SELECT 1'), /must be inside/);
  await assert.rejects(q('missing', 'SELECT 1'), /not found/);
});

test('row cap and timeout', async () => {
  const r = await q('demo', 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s) SELECT n FROM s');
  assert.equal(r.returned, 200); assert.equal(r.truncated, true);
  const t0 = Date.now();
  await assert.rejects(q('demo', 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s LIMIT 100000000) SELECT count(*) FROM s a, s b'), /cancelled/);
  assert.ok(Date.now() - t0 < 5000);
});
