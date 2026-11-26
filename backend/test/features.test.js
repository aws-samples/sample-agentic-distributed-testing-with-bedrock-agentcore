import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// A throwaway database, set before the store is first imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'features-test-'));
process.env.SQLITE_DB_PATH = path.join(tmp, 'test.db');

const { default: featureRoutes, CASE_LIMITS } = await import('../src/routes/features.js');
const { featureList, testCasesByFeature } = await import('../src/state/store.js');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', featureRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (url, body) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function newFeature(name) {
  const r = await post('/features', { name });
  assert.equal(r.status, 200);
  return name;
}

test('creates a blank scenario with a fresh global id and no AI call', async () => {
  const feat = await newFeature('Blank cases');
  const r = await post(`/features/${encodeURIComponent(feat)}/cases`, { title: 'New scenario', given: [''], when: [''], then: [''] });
  assert.equal(r.status, 201);
  const tc = await r.json();
  assert.match(tc.id, /^TC\d{3,}$/);
  assert.equal(tc.title, 'New scenario');
  assert.deepEqual(tc.given, ['']);
  assert.equal(testCasesByFeature[feat].length, 1);
});

test('an id already used in another feature is replaced, the original is untouched', async () => {
  const a = await newFeature('Feature A');
  const b = await newFeature('Feature B');
  const first = await (await post(`/features/${encodeURIComponent(a)}/cases`, { title: 'Original', when: ['open the target URL'] })).json();
  const r = await post(`/features/${encodeURIComponent(b)}/cases`, { id: first.id, title: 'Copy of Original', when: ['open the target URL'] });
  assert.equal(r.status, 201);
  const copy = await r.json();
  assert.notEqual(copy.id, first.id);
  assert.equal(testCasesByFeature[a].find(t => t.id === first.id).title, 'Original');
});

test('a free TC id from the client is kept; a legacy id is not', async () => {
  const feat = await newFeature('Ids');
  const free = await (await post(`/features/${encodeURIComponent(feat)}/cases`, { id: 'TC900', title: 'Keeps id' })).json();
  assert.equal(free.id, 'TC900');
  const legacy = await (await post(`/features/${encodeURIComponent(feat)}/cases`, { id: 'MD001-TC001', title: 'Legacy id' })).json();
  assert.match(legacy.id, /^TC\d{3,}$/);
  assert.equal(legacy.id, 'TC901');
});

test('rejects bad input', async () => {
  const feat = await newFeature('Validation');
  const url = `/features/${encodeURIComponent(feat)}/cases`;
  for (const body of [
    {},
    { title: '   ' },
    { title: 42 },
    { title: 'x'.repeat(CASE_LIMITS.title + 1) },
    { title: 'ok', when: [{ nested: true }] },
    { title: 'ok', given: Array(CASE_LIMITS.steps + 1).fill('step') },
    { title: 'ok', then: ['y'.repeat(CASE_LIMITS.step + 1)] },
  ]) {
    const r = await post(url, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(testCasesByFeature[feat].length, 0);
});

test('unknown feature is 404', async () => {
  const r = await post('/features/nope/cases', { title: 'x' });
  assert.equal(r.status, 404);
  assert.ok(!featureList.includes('nope'));
});
