import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import yaml from 'js-yaml';

// A throwaway database, set before the store is first imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-add-test-'));
process.env.SQLITE_DB_PATH = path.join(tmp, 'test.db');

const { default: yamlRoutes } = await import('../src/routes/yaml.js');
const { featureList, testCasesByFeature, featureDescriptions } = await import('../src/state/store.js');
const { loadFeaturesAndCases } = await import('../src/state/db.js');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/import', express.text({ type: 'text/yaml' }));
  app.use('/api', yamlRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const importYaml = (text, query = '') => fetch(`${base}/import${query}`, {
  method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: text,
});
const preview = (text) => importYaml(text, '?mode=add&dryRun=1');
const add = (text) => importYaml(text, '?mode=add');
const suite = (features) => yaml.dump({ features });
const tc = (id, scenario) => ({ id, scenario, given: ['the app is open'], when: ['I do it'], then: ['it works'] });

// Every test starts from the same saved suite (through the normal replace import).
const START = [
  { name: 'Transfers', description: 'Given I am signed in', testCases: [tc('TC001', 'Happy path'), tc('TC002', 'Empty amount')] },
  { name: 'Accounts', testCases: [tc('TC003', 'View balance')] },
];
beforeEach(async () => {
  const r = await importYaml(suite(START));
  assert.equal(r.status, 200);
});

// What the database holds, as { feature: [ 'TC001 Happy path', ... ] }.
function saved() {
  const { features, casesByFeature } = loadFeaturesAndCases();
  return Object.fromEntries(features.map(f => [f, casesByFeature[f].map(c => `${c.id} ${c.title}`)]));
}

test('add merges a same-name feature, adds a new one, keeps everything that was there', async () => {
  const file = suite([
    { name: 'Transfers', testCases: [tc('TC001', 'Transfer above balance'), tc(undefined, 'happy  PATH')] },
    { name: 'Login', description: 'Given the sign-on page', testCases: [tc('TC002', 'Wrong password')] },
  ]);
  const r = await add(file);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.summary, { features: 2, featuresAdded: 1, featuresMerged: 1, casesAdded: 2, casesSkipped: 1 });
  assert.deepEqual(saved(), {
    Transfers: ['TC001 Happy path', 'TC002 Empty amount', 'TC004 Transfer above balance'],
    Accounts: ['TC003 View balance'],
    Login: ['TC005 Wrong password'],
  });
  const transfers = body.features.find(f => f.name === 'Transfers');
  assert.equal(transfers.status, 'merged');
  assert.deepEqual(transfers.skip, [{ title: 'happy  PATH', reason: 'title already exists' }]);
  assert.equal(body.features.find(f => f.name === 'Login').status, 'added');
  assert.equal(featureDescriptions.Login, 'Given the sign-on page');
  // Memory and database agree.
  assert.deepEqual(featureList, ['Transfers', 'Accounts', 'Login']);
  assert.equal(testCasesByFeature.Transfers.length, 3);
});

test('dry run returns the same plan and writes nothing', async () => {
  const before = saved();
  const file = suite([{ name: 'Login', testCases: [tc('TC001', 'Wrong password')] }]);
  const r = await preview(file);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.dryRun, true);
  assert.deepEqual(body.features[0].add, [{ id: 'TC004', title: 'Wrong password' }]);
  assert.deepEqual(saved(), before);
  assert.ok(!featureList.includes('Login'));
});

test('a same-name feature with a different Background keeps the existing one and says so', async () => {
  const r = await add(suite([{ name: 'Transfers', description: 'Given I am an admin', testCases: [tc(null, 'Cancel transfer')] }]));
  const body = await r.json();
  assert.equal(body.features[0].backgroundDiffers, true);
  assert.equal(featureDescriptions.Transfers, 'Given I am signed in');
  assert.equal(loadFeaturesAndCases().descriptions.Transfers, 'Given I am signed in');
  // Same Background, or none: no warning.
  const same = await (await preview(suite([{ name: 'Transfers', description: 'Given I am signed in', testCases: [] }]))).json();
  assert.equal(same.features[0].backgroundDiffers, false);
  const none = await (await preview(suite([{ name: 'Transfers', testCases: [] }]))).json();
  assert.equal(none.features[0].backgroundDiffers, false);
});

test('a file with only clashes adds nothing', async () => {
  const before = saved();
  const r = await add(suite([
    { name: 'Transfers', testCases: [tc('TC001', 'Happy path'), tc('TC002', 'Empty amount')] },
    { name: 'Accounts', testCases: [tc('TC009', 'View balance')] },
  ]));
  const body = await r.json();
  assert.deepEqual(body.summary, { features: 2, featuresAdded: 0, featuresMerged: 2, casesAdded: 0, casesSkipped: 3 });
  assert.deepEqual(saved(), before);
});

test('ids in the file are ignored: used ids, missing ids, legacy ids and repeats all get new ones', async () => {
  const r = await add(suite([{ name: 'Login', testCases: [
    tc('TC003', 'A'), tc('TC003', 'B'), tc('MD001-TC001', 'C'), tc(undefined, 'D'), tc('TC999', 'E'),
  ] }]));
  const body = await r.json();
  assert.deepEqual(body.features[0].add.map(c => c.id), ['TC004', 'TC005', 'TC006', 'TC007', 'TC008']);
  const ids = Object.values(saved()).flat().map(s => s.split(' ')[0]);
  assert.equal(new Set(ids).size, ids.length);
});

test('the same title twice in one file is added once, the repeat is skipped', async () => {
  const body = await (await preview(suite([{ name: 'Login', testCases: [tc(null, 'Wrong password'), tc(null, 'Wrong Password')] }]))).json();
  assert.equal(body.features[0].add.length, 1);
  assert.deepEqual(body.features[0].skip, [{ title: 'Wrong Password', reason: 'same title twice in this file' }]);
});

test('the same feature twice in one file becomes one group', async () => {
  const body = await (await preview(suite([
    { name: 'Login', testCases: [tc(null, 'A')] },
    { name: 'Login', testCases: [tc(null, 'B'), tc(null, 'A')] },
  ]))).json();
  assert.equal(body.features.length, 1);
  assert.deepEqual(body.features[0].add.map(c => c.title), ['A', 'B']);
  assert.equal(body.features[0].skip.length, 1);
});

test('30 cases in one feature are all planned and added', async () => {
  const cases = Array.from({ length: 30 }, (_, i) => tc(null, `Case ${i + 1}`));
  const body = await (await add(suite([{ name: 'Transfers', testCases: cases }]))).json();
  assert.equal(body.summary.casesAdded, 30);
  assert.equal(saved().Transfers.length, 32);
  assert.equal(saved().Transfers.at(-1), 'TC033 Case 30');
});

test('a case with no scenario name is skipped with the reason', async () => {
  const body = await (await preview(suite([{ name: 'Login', testCases: [{ when: ['x'] }, tc(null, 'Ok')] }]))).json();
  assert.deepEqual(body.features[0].skip, [{ title: '(no scenario name)', reason: 'no scenario name' }]);
  assert.equal(body.features[0].add.length, 1);
});

test('empty, malformed and wrong-shape files are refused and write nothing', async () => {
  const before = saved();
  for (const text of ['', ':\n  - [unclosed', 'just a string', 'features: nope']) {
    const r = await add(text);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(text)}`);
    assert.match((await r.json()).error, /YAML|features|No YAML/);
  }
  assert.deepEqual(saved(), before);
});

test('an empty features list adds nothing', async () => {
  const body = await (await add('features: []\n')).json();
  assert.deepEqual(body.summary, { features: 0, featuresAdded: 0, featuresMerged: 0, casesAdded: 0, casesSkipped: 0 });
});

test('add mode does not change the target URL', async () => {
  const { config } = await import('../src/state/store.js');
  const was = config.targetUrl;
  await add(yaml.dump({ targetUrl: 'https://example.com/other', features: [{ name: 'Login', testCases: [tc(null, 'A')] }] }));
  assert.equal(config.targetUrl, was);
});

test('Replace suite still replaces: features not in the file are removed', async () => {
  const r = await importYaml(suite([{ name: 'Login', testCases: [tc('TC001', 'Wrong password')] }]));
  assert.equal(r.status, 200);
  assert.deepEqual(saved(), { Login: ['TC001 Wrong password'] });
  assert.deepEqual(featureList, ['Login']);
});
