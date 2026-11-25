// Runs against real databases only when told where they are, e.g.
//   DB_TEST_PG=postgres://postgres:pw@127.0.0.1:5432/postgres DB_TEST_MYSQL=mysql://root:pw@127.0.0.1:3306/bank npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targets = [['pg', 'postgres', process.env.DB_TEST_PG], ['my', 'mysql', process.env.DB_TEST_MYSQL]]
  .filter(t => t[2]).map(([name, type, url]) => {
    const u = new URL(url);
    return { name, type, host: u.hostname, port: Number(u.port), database: u.pathname.slice(1), user: u.username, password: decodeURIComponent(u.password), ssl: 'off' };
  });

if (!targets.length) test('database integration (set DB_TEST_PG / DB_TEST_MYSQL to run)', { skip: true }, () => {});
else {
  const dir = mkdtempSync(join(tmpdir(), 'dbtest-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify(targets), { mode: 0o600 });
  process.env.DB_CONNECTIONS_FILE = file;
  const { callTool, run } = await import('../src/db-server.js');

  // Fixture: written with the plain drivers, not through the read-only tools.
  for (const c of targets) {
    if (c.type === 'postgres') {
      const { default: pg } = await import('pg');
      const cl = new pg.Client({ ...c, ssl: false }); await cl.connect();
      await cl.query('CREATE TABLE IF NOT EXISTS accounts (id int PRIMARY KEY, owner text, balance numeric)');
      await cl.query('CREATE TABLE IF NOT EXISTS transactions (id int PRIMARY KEY, account_id int REFERENCES accounts(id), amount numeric)');
      await cl.query("INSERT INTO accounts VALUES (1,'ann',100) ON CONFLICT DO NOTHING");
      await cl.query('INSERT INTO transactions VALUES (1,1,25) ON CONFLICT DO NOTHING');
      await cl.end();
    } else {
      const my = await import('mysql2/promise');
      const cl = await my.createConnection({ ...c, ssl: undefined });
      await cl.query('CREATE TABLE IF NOT EXISTS accounts (id int PRIMARY KEY, owner varchar(20), balance decimal(10,2))');
      await cl.query('CREATE TABLE IF NOT EXISTS transactions (id int PRIMARY KEY, account_id int, amount decimal(10,2), FOREIGN KEY (account_id) REFERENCES accounts(id))');
      await cl.query("INSERT IGNORE INTO accounts VALUES (1,'ann',100)");
      await cl.query('INSERT IGNORE INTO transactions VALUES (1,1,25)');
      await cl.end();
    }
  }

  for (const c of targets) {
    test(`${c.type}: schema tools and a read`, async () => {
      const tables = await callTool('list_tables', { connection: c.name });
      assert.ok(tables.rows.some(r => r.table === 'transactions'));
      const d = await callTool('describe_table', { connection: c.name, table: 'transactions' });
      assert.deepEqual(d.columns.map(x => x.name), ['id', 'account_id', 'amount']);
      assert.ok(d.keys.some(k => k.ref_table === 'accounts'), 'foreign key reported');
      const q = await callTool('query', { connection: c.name, sql: 'SELECT COUNT(*) AS n FROM transactions WHERE account_id = 1;' });
      assert.equal(String(q.rows[0].n), '1');
      await assert.rejects(callTool('describe_table', { connection: c.name, table: 'nope' }), /No table named/);
    });

    test(`${c.type}: writes are refused by the guard and by the read-only transaction`, async () => {
      await assert.rejects(callTool('query', { connection: c.name, sql: 'DELETE FROM transactions' }), /Read-only connection/);
      // Skip the statement check to prove the database itself refuses.
      await assert.rejects(run(targets.find(t => t === c), 'DELETE FROM transactions', [], { guard: false }), /read-only|READ ONLY/i);
      const q = await callTool('query', { connection: c.name, sql: 'SELECT COUNT(*) AS n FROM transactions' });
      assert.equal(String(q.rows[0].n), '1');
    });

    test(`${c.type}: row cap and timeout`, async () => {
      const gen = c.type === 'postgres' ? 'SELECT g AS n FROM generate_series(1, 1000) g' : 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 1000) SELECT n FROM s';
      const q = await callTool('query', { connection: c.name, sql: gen });
      assert.equal(q.returned, 200);
      assert.equal(q.truncated, true);
      // Reading stops at the cap: a result of hundreds of millions of rows comes back at once.
      const huge = c.type === 'postgres'
        ? 'SELECT a.x FROM generate_series(1, 1000) a(x), generate_series(1, 1000) b(x), generate_series(1, 1000) d(x)'
        : 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 1000) SELECT a.n FROM s a, s b, s d';
      const t1 = Date.now();
      const h = await callTool('query', { connection: c.name, sql: huge });
      assert.equal(h.returned, 200);
      assert.ok(Date.now() - t1 < 8000, 'stopped at the cap instead of reading everything');
      const slow = c.type === 'postgres' ? 'SELECT pg_sleep(30)' : 'SELECT SLEEP(30)';
      const t0 = Date.now();
      await callTool('query', { connection: c.name, sql: slow }).catch(() => {});
      assert.ok(Date.now() - t0 < 25000, 'cancelled by the timeout');
    });

    test(`${c.type}: wrong password error does not leak the password`, async () => {
      const { maskSecrets } = await import('../src/db-util.js');
      assert.ok(!maskSecrets(`password ${c.password} bad`, [c]).includes(c.password));
    });
  }
}
