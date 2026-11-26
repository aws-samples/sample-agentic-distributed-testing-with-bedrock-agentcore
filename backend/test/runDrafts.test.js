import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-drafts-test-'));
process.env.SQLITE_DB_PATH = path.join(tmp, 'test.db');

const { default: testRoutes } = await import('../src/routes/tests.js');
const { hasSteps } = await import('../src/services/tcIds.js');
const { testRuns } = await import('../src/state/store.js');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', testRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('hasSteps: empty, blank and whitespace-only rows are not steps', () => {
  for (const tc of [
    {}, null, { given: [], when: [], then: [] }, { given: [''], when: [''], then: [''] },
    { given: ['  '], when: ['\t'], then: ['\n '] }, { given: '', when: '   ' }, { when: [42, null] },
  ]) assert.equal(hasSteps(tc), false, JSON.stringify(tc));
});

test('hasSteps: one real step in any section is enough', () => {
  for (const tc of [
    { when: ['click Pay'] }, { given: ['a'], when: [''], then: [''] }, { then: ['  ok  '] }, { when: 'a string step' },
  ]) assert.equal(hasSteps(tc), true, JSON.stringify(tc));
});

test('a run made only of cases with no steps is refused and nothing is started', async () => {
  const cases = [
    { id: 'TC001', feature: 'F', title: 'empty', given: [], when: [], then: [] },
    { id: 'TC002', feature: 'F', title: 'blank rows', given: [''], when: [''], then: [''] },
    { id: 'TC003', feature: 'F', title: 'spaces', given: ['  '], when: [' '], then: ['\t'] },
  ];
  const before = Object.keys(testRuns).length;
  const r = await fetch(base + '/tests/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testCases: cases }),
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).skipped, ['TC001', 'TC002', 'TC003']);
  assert.equal(Object.keys(testRuns).length, before);
});
