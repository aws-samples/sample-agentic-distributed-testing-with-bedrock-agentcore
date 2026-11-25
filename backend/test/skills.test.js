import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'skillstest-')));
const allowed = join(dir, 'allowed'); const other = join(dir, 'other');
mkdirSync(allowed); mkdirSync(other);
for (const f of [join(allowed, 'carddemo.db'), join(other, 'secret.db')]) {
  const d = new Database(f); d.exec("CREATE TABLE accounts (account_id TEXT PRIMARY KEY, balance REAL); INSERT INTO accounts VALUES ('A1', 10)"); d.close();
}
symlinkSync(join(other, 'secret.db'), join(allowed, 'link.db'));
process.env.SQLITE_DB_PATH = join(dir, 'data.db');
process.env.CONFIG_PATH = join(dir, 'config.json');
process.env.DB_SQLITE_DIRS = allowed;

const { applyDefaults, normalizeSkills, skillsForRun, normalizeTools, CARDDEMO_SKILL } = await import('../src/state/skills.js');
const { default: express } = await import('express');
const { default: databaseRoutes } = await import('../src/routes/databases.js');
const { default: toolRoutes } = await import('../src/routes/tools.js');
const { config } = await import('../src/state/store.js');

let server, base;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', databaseRoutes); app.use('/api', toolRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await new Promise(r => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
});
const call = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));

const empty = { dbConnections: [], skills: [], flags: {} };

test('fresh install: CardDemo connection and starter skill, once', () => {
  const first = applyDefaults(empty);
  assert.equal(first.changed, true);
  assert.equal(first.state.dbConnections[0].name, 'CardDemo');
  assert.equal(first.state.dbConnections[0].type, 'sqlite');
  assert.equal(first.state.dbConnections[0].sample, true);
  assert.equal(first.state.dbConnections[0].password, '');
  assert.deepEqual(first.state.skills.map(s => s.id), [CARDDEMO_SKILL.id]);
  const again = applyDefaults(first.state);
  assert.equal(again.changed, false, 're-running does nothing');
  assert.deepEqual(again.state, first.state);
});

test('a deleted CardDemo is not seeded again', () => {
  const { state } = applyDefaults(empty);
  const deleted = applyDefaults({ ...state, dbConnections: [], skills: [] });
  assert.equal(deleted.changed, false);
  assert.deepEqual(deleted.state.dbConnections, []);
});

test('an install that already has connections is not seeded, but the flag is set', () => {
  const r = applyDefaults({ dbConnections: [{ name: 'bank', type: 'postgres', description: 'status A = active' }], skills: [], flags: {} });
  assert.deepEqual(r.state.dbConnections.map(c => c.name), ['bank']);
  assert.equal(r.state.flags.cardDemoSeeded, true);
});

test('descriptions move into skills once, with a backup first; nothing is lost', () => {
  let backups = 0;
  const conns = [{ name: 'bank', type: 'postgres', description: 'status A = active' }, { name: 'plain', type: 'mysql', description: '  ' }];
  const r = applyDefaults({ dbConnections: conns, skills: [], flags: {} }, () => backups++);
  assert.equal(backups, 1);
  assert.deepEqual(r.state.skills.map(s => [s.name, s.text, s.tool, s.enabled]), [['bank notes', 'status A = active', 'database', true]]);
  assert.ok(r.state.dbConnections.every(c => c.description === ''));
  const again = applyDefaults(r.state, () => backups++);
  assert.equal(backups, 1, 'no second backup');
  assert.equal(again.changed, false);
  assert.equal(again.state.skills.length, 1, 'no duplicate skill');
  // Same migration if the flag were lost: the id makes it idempotent.
  const lost = applyDefaults({ dbConnections: conns, skills: r.state.skills, flags: {} }, () => {});
  assert.equal(lost.state.skills.length, 1);
});

test('loading an existing config file: backup written, skills created, second load changes nothing', async () => {
  const legacy = join(dir, 'legacy'); mkdirSync(legacy);
  const file = join(legacy, 'config.json');
  const original = JSON.stringify({ targetUrl: 'http://x', dbConnections: [{ name: 'bank', type: 'postgres', host: 'h', database: 'd', user: 'u', password: 'pw', description: 'notes for bank' }] });
  writeFileSync(file, original);
  process.env.CONFIG_PATH = file;
  const m1 = await import('../src/state/store.js?first');
  assert.deepEqual(m1.config.skills.map(s => s.name), ['bank notes']);
  assert.equal(m1.config.dbConnections.length, 1, 'existing connections: CardDemo not added');
  assert.equal(m1.config.dbConnections[0].description, '');
  await new Promise(r => setTimeout(r, 700));
  const backups = readdirSync(legacy).filter(f => f.includes('.pre-skills-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(legacy, backups[0]), 'utf8'), original, 'backup is the config as it was');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.flags, { skillsMigrated: true, cardDemoSeeded: true });
  const m2 = await import('../src/state/store.js?second');
  assert.deepEqual(m2.config.skills, m1.config.skills);
  await new Promise(r => setTimeout(r, 700));
  assert.equal(readdirSync(legacy).filter(f => f.includes('.pre-skills-')).length, 1, 'second load made no backup');
  process.env.CONFIG_PATH = join(dir, 'config.json');
});

test('skills sent to a run: enabled, and general or attached to an enabled tool', () => {
  const skills = normalizeSkills([
    { id: 'a', name: 'A', text: 'x', tool: 'database', enabled: true }, { id: 'b', name: 'B', text: 'y', tool: null, enabled: true },
    { id: 'c', name: 'C', text: 'z', tool: 'database', enabled: false }, { id: 'a', name: 'dup', text: '' }, { id: 'd', name: 'D', text: '', tool: 'nope' },
  ]);
  assert.deepEqual(skills.map(s => s.id), ['a', 'b', 'c', 'd']);
  assert.equal(skills[3].tool, null);
  assert.deepEqual(skillsForRun(skills, normalizeTools({})).map(s => s.name), ['A', 'B', 'D']);
  assert.deepEqual(skillsForRun(skills, normalizeTools({ database: { enabled: false } })).map(s => s.name), ['B', 'D']);
});

test('tools routes: list, switch off, reject unknown', async () => {
  assert.deepEqual((await call('GET', '/config/tools')).body.tools, [{ id: 'database', name: 'Database', enabled: true }]);
  assert.equal((await call('PUT', '/config/tools', { tools: { database: { enabled: false } } })).body.tools[0].enabled, false);
  assert.equal(config.tools.database.enabled, false);
  assert.equal((await call('PUT', '/config/tools', { tools: { nope: { enabled: true } } })).status, 400);
  assert.equal((await call('PUT', '/config/tools', { tools: [] })).status, 400);
  await call('PUT', '/config/tools', { tools: { database: { enabled: true } } });
});

test('skills routes: save, validate, replace the whole list', async () => {
  const ok = await call('PUT', '/config/skills', { skills: [{ name: 'Mine', text: 'hello', tool: 'database', enabled: true }, { id: 'x1', name: 'Other', text: 't', tool: null, enabled: false }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.skills.length, 2);
  assert.equal((await call('GET', '/config/skills')).body.skills[1].enabled, false);
  for (const bad of [{ skills: 'x' }, { skills: [{ name: '', text: 't' }] }, { skills: [{ name: 'n', text: 'x'.repeat(4001) }] }, { skills: [{ name: 'n', text: 't', tool: 'nope' }] }, { skills: [{ id: 'a', name: 'n' }, { id: 'a', name: 'm' }] }]) {
    assert.equal((await call('PUT', '/config/skills', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(config.skills.length, 2, 'a refused save changes nothing');
});

const lite = (database) => ({ name: 'CardDemo', type: 'sqlite', database });

test('sqlite connection: test and schema work inside the allowed directory only', async () => {
  const good = await call('POST', '/config/databases/test', { connection: lite(join(allowed, 'carddemo.db')) });
  assert.equal(good.body.ok, true);
  assert.match(good.body.message, /SQLite .*1 tables/);
  const schema = await call('POST', '/config/databases/schema', { connection: lite(join(allowed, 'carddemo.db')) });
  assert.match(schema.body.draft, /accounts\(account_id TEXT, balance REAL\)/);
  for (const path of [join(other, 'secret.db'), join(allowed, 'link.db'), join(allowed, '..', 'other', 'secret.db'), '/etc/passwd', join(allowed, 'missing.db')]) {
    const r = await call('POST', '/config/databases/test', { connection: lite(path) });
    assert.equal(r.body.ok, false, path);
    assert.match(r.body.message, /must be inside|not found/, path);
  }
  assert.equal((await call('POST', '/config/databases/test', { connection: lite('') })).status, 400);
});

test('sqlite connection is saved without a server, login or password', async () => {
  const put = await call('PUT', '/config/databases', { connections: [{ ...lite(join(allowed, 'carddemo.db')), host: 'evil', user: 'x', password: 'p', sample: true }] });
  assert.equal(put.status, 200);
  const c = put.body.connections[0];
  assert.deepEqual([c.host, c.user, c.hasPassword, c.ssl, c.type, c.sample], ['', '', false, 'off', 'sqlite', true]);
});
