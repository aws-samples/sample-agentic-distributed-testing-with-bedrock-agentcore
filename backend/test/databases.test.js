import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep the test away from the real state directory.
const dir = mkdtempSync(join(tmpdir(), 'dbroutes-'));
process.env.SQLITE_DB_PATH = join(dir, 'data.db');
process.env.CONFIG_PATH = join(dir, 'config.json');

const { default: express } = await import('express');
const { default: databaseRoutes } = await import('../src/routes/databases.js');
const { default: configRoutes } = await import('../src/routes/config.js');
const { config } = await import('../src/state/store.js');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', configRoutes);
  app.use('/api', databaseRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await new Promise(r => setTimeout(r, 500));   // let the debounced config save finish before the directory goes
  rmSync(dir, { recursive: true, force: true });
});

const call = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));

const conn = { name: 'bank', type: 'postgres', host: '127.0.0.1', port: 1, database: 'bank', user: 'ro', password: 'hunter2-secret', ssl: 'off', description: 'status A = active' };

test('saves connections; the password is in no GET response', async () => {
  const put = await call('PUT', '/config/databases', { connections: [conn] });
  assert.equal(put.status, 200);
  assert.ok(!JSON.stringify(put.body).includes('hunter2-secret'));
  assert.equal(config.dbConnections[0].password, 'hunter2-secret');   // kept for the run request

  const got = await call('GET', '/config/databases');
  assert.equal(got.body.connections[0].hasPassword, true);
  assert.ok(!JSON.stringify(got.body).includes('hunter2-secret'));

  for (const path of ['/config', '/health', '/config/env']) {
    const r = await call('GET', path);
    assert.ok(!JSON.stringify(r.body).includes('hunter2-secret'), path);
  }
});

test('an update without a password keeps the saved one; a string replaces it', async () => {
  const { password, ...noPw } = conn;
  await call('PUT', '/config/databases', { connections: [{ ...noPw, description: 'edited' }] });
  assert.equal(config.dbConnections[0].password, 'hunter2-secret');
  assert.equal(config.dbConnections[0].description, 'edited');
  await call('PUT', '/config/databases', { connections: [{ ...conn, password: 'new-pw' }] });
  assert.equal(config.dbConnections[0].password, 'new-pw');
  await call('PUT', '/config/databases', { connections: [conn] });
});

test('the saved password is reused only for the same host, port, user and type', async () => {
  await call('PUT', '/config/databases', { connections: [conn] });
  const { password, ...noPw } = conn;
  for (const change of [{ host: 'evil.example' }, { port: 5555 }, { user: 'other' }, { type: 'mysql' }]) {
    for (const [path, body] of [
      ['/config/databases/test', { connection: { ...noPw, ...change } }],
      ['/config/databases/schema', { connection: { ...noPw, ...change } }],
      ['/config/databases', { connections: [{ ...noPw, ...change }] }],
    ]) {
      const r = await call(path.endsWith('databases') ? 'PUT' : 'POST', path, body);
      assert.equal(r.status, 400, `${path} ${JSON.stringify(change)}`);
      assert.match(r.body.error, /re-enter the password/);
    }
  }
  assert.equal(config.dbConnections[0].host, '127.0.0.1', 'a rejected save changes nothing');
  assert.equal(config.dbConnections[0].password, 'hunter2-secret');
  // Supplying the password again is fine, and so is a change of description only.
  assert.equal((await call('PUT', '/config/databases', { connections: [{ ...conn, host: 'db.internal', password: 'pw-for-new-host' }] })).status, 200);
  assert.equal(config.dbConnections[0].password, 'pw-for-new-host');
  assert.equal((await call('PUT', '/config/databases', { connections: [{ ...conn, host: 'db.internal', password: undefined, description: 'x' }] })).status, 200);
  assert.equal(config.dbConnections[0].password, 'pw-for-new-host');
  await call('PUT', '/config/databases', { connections: [conn] });
});

test('Test connection refuses link-local and metadata addresses', async () => {
  for (const host of ['169.254.169.254', '::ffff:169.254.169.254', 'fe80::1', 'fd00:ec2::254']) {
    const r = await call('POST', '/config/databases/test', { connection: { ...conn, host } });
    assert.equal(r.body.ok, false, host);
    assert.match(r.body.message, /not allowed/, host);
  }
});

test('validates the whole list', async () => {
  for (const bad of [
    { ...conn, name: '1bad' }, { ...conn, type: 'oracle' }, { ...conn, host: '' }, { ...conn, port: 70000 },
    { ...conn, database: '' }, { ...conn, user: '' }, { ...conn, ssl: 'maybe' }, { ...conn, description: 'x'.repeat(4001) },
  ]) {
    const r = await call('PUT', '/config/databases', { connections: [bad] });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PUT', '/config/databases', { connections: [conn, { ...conn, name: 'BANK' }] })).status, 400);
  assert.equal(config.dbConnections.length, 1, 'a rejected save changes nothing');
});

test('Test connection reports a readable error that does not contain the password', async () => {
  const r = await call('POST', '/config/databases/test', { connection: { ...conn, password: 'hunter2-secret' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.message.length > 0);
  assert.ok(!r.body.message.includes('hunter2-secret'));
});

// Against a real PostgreSQL / MySQL only when told where: DB_TEST_PG=postgres://user:pw@host:port/db
for (const [env, type] of [['DB_TEST_PG', 'postgres'], ['DB_TEST_MYSQL', 'mysql']]) {
  test(`${type}: Test connection and Load schema against a live server`, { skip: !process.env[env] }, async () => {
    const u = new URL(process.env[env]);
    const c = { name: 'live', type, host: u.hostname, port: Number(u.port), database: u.pathname.slice(1), user: u.username, password: decodeURIComponent(u.password), ssl: 'off' };
    const t = await call('POST', '/config/databases/test', { connection: c });
    assert.equal(t.body.ok, true, t.body.message);
    const s = await call('POST', '/config/databases/schema', { connection: c });
    assert.equal(s.body.ok, true, s.body.message);
    assert.match(s.body.draft, /- transactions\(.*account_id/);
    const wrong = await call('POST', '/config/databases/test', { connection: { ...c, password: 'wrong-pw-xyz' } });
    assert.equal(wrong.body.ok, false);
    assert.ok(!wrong.body.message.includes('wrong-pw-xyz'));
  });
}
