// Redo of finished cases while a feature is paused: POST /api/tests/redo against the real router
// and run loop, with a fake local runtime (one HTTP server) standing in for the agent.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redo-paused-'));
process.env.SQLITE_DB_PATH = path.join(dir, 'data.db');

// Fake runtime: `init` answers with a screenshot; `run_test` waits for gate(tcId), then passes
// or fails by `verdicts[tcId]`. `calls` records the order, with the hint each call carried.
const calls = [];
const gates = {};            // tcId -> resolve fn, set while that call is waiting
const holdCases = new Set(); // tcIds whose next call waits for release(tcId)
const verdicts = {};
const sse = (ev) => `data: ${JSON.stringify({ event: ev })}\n\n`;
const runtime = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    if (req.url !== '/') { res.writeHead(404); return res.end(); }
    const p = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (p.action === 'init') return res.end(sse({ screenshot: { data: 'AAAA' } }));
    const id = p.testCase.id;
    calls.push({ id, hint: p.hint || '' });
    if (holdCases.has(id)) { holdCases.delete(id); await new Promise(r => { gates[id] = r; }); }
    const passed = verdicts[id] !== false;
    res.end(sse({ contentBlockDelta: { delta: { text: JSON.stringify({ passed, reason: `${id} ${passed ? 'ok' : 'bad'}` }) } } }));
  });
});
await new Promise(r => runtime.listen(0, '127.0.0.1', r));
process.env.LOCAL_RUNTIME_URL = `http://127.0.0.1:${runtime.address().port}`;

const store = await import('../src/state/store.js');
const { default: testRoutes } = await import('../src/routes/tests.js');
const { stopScreenPoller } = await import('../src/services/sessions.js');
const { pausedFeatures, heldFeatures, redoQueues } = await import('../src/services/runControl.js');
const { runArchive } = await import('../src/state/archive.js');

store.config.agentMode = 'local';
const app = express();
app.use(express.json());
app.use('/api', testRoutes);
const api = http.createServer(app);
await new Promise(r => api.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${api.address().port}/api`;
const post = async (p, body) => { const r = await fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const until = async (fn, what) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(`timed out: ${what}`); };
const caseOf = (runId, tcId) => runArchive.find(r => r.runId === runId)?.features.F.cases.find(c => c.id === tcId);

const feature = 'F';
const tcs = ['TC901', 'TC902', 'TC903', 'TC904'].map(id => ({ id, feature, title: id, given: [], when: [], then: [] }));

before(() => {
  store.featureList.push(feature);
  store.testCasesByFeature[feature] = tcs;
});
after(() => {
  stopScreenPoller(feature);
  runtime.close(); api.close();
  fs.rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 50).unref();   // the store keeps a DB handle open
});

const redo = (ids, hint = 'use the menu') => post('/tests/redo', { feature, testCaseIds: ids, hint });
const finish = async (runId) => { await until(() => store.testRuns[runId] && !store.activeRunPromises.has(runId), `run ${runId} done`); };

test('redo while paused: runs in the same session before the held loop resumes, keeps both results', async () => {
  verdicts.TC901 = false;
  holdCases.add('TC903');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => calls.some(c => c.id === 'TC903'), 'TC903 started');     // TC901, TC902 finished

  // Paused while TC903 is still running: finished cases are accepted, the running case is not.
  await post('/tests/pause', { feature });
  assert.ok(pausedFeatures.has(feature));
  assert.equal((await redo(['TC903'])).status, 409);
  gates.TC903();
  await until(() => heldFeatures.has(feature), 'held before TC904');
  assert.equal((await redo(['TC904'])).status, 409);                          // not reached yet

  verdicts.TC901 = true;                                                      // the hint fixes it
  const r1 = await redo(['TC901']);
  assert.equal(r1.status, 200);
  await finish(r1.body.runId);
  assert.deepEqual(calls.map(c => c.id), ['TC901', 'TC902', 'TC903', 'TC901']);   // TC904 still held
  assert.equal(calls[3].hint, 'use the menu');
  assert.ok(pausedFeatures.has(feature) && store.activeFeatures.has(feature));

  await post('/tests/resume', { feature });
  await finish(main);
  assert.deepEqual(calls.map(c => c.id), ['TC901', 'TC902', 'TC903', 'TC901', 'TC904']);
  assert.equal(caseOf(r1.body.runId, 'TC901').retryOf, main);
  assert.equal(caseOf(r1.body.runId, 'TC901').hint, 'use the menu');
  assert.equal(caseOf(main, 'TC901').status, 'FAIL');
  assert.equal(caseOf(main, 'TC901').retries[0].runId, r1.body.runId);
  assert.equal(caseOf(r1.body.runId, 'TC901').status, 'PASS');
  assert.ok(!store.activeFeatures.has(feature) && !redoQueues.has(feature));
});

test('paused with nothing finished: no redo; a redo queued twice or while running is refused; Stop during a paused redo', async () => {
  calls.length = 0;
  for (const k of Object.keys(gates)) delete gates[k];
  for (const k of Object.keys(verdicts)) delete verdicts[k];
  verdicts.TC901 = false;
  holdCases.add('TC901');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => calls.length === 1, 'TC901 running');
  await post('/tests/pause', { feature });

  // Nothing has finished: every case reads RUNNING / PENDING, so none can be redone.
  for (const id of ['TC901', 'TC902']) assert.equal((await redo([id])).status, 409);
  gates.TC901();
  await until(() => heldFeatures.has(feature), 'held after TC901');
  assert.equal((await redo(['TC902'])).status, 409);                          // not reached yet

  holdCases.add('TC901');
  const a = await redo(['TC901'], 'first');
  assert.equal(a.status, 200);
  assert.equal((await redo(['TC901'], 'second')).status, 409);                // already has a redo waiting
  await until(() => gates.TC901 && calls.length === 2, 'redo of TC901 running');
  assert.equal(calls[1].hint, 'first');
  assert.equal((await redo(['TC901'], 'third')).status, 409);                 // running now
  assert.ok(pausedFeatures.has(feature));

  // Stop while the paused redo runs: the case in the agent ends, the held loop does not go on.
  await post('/tests/stop', {});
  gates.TC901();
  await finish(a.body.runId);
  await finish(main);
  assert.deepEqual(calls.map(c => c.id), ['TC901', 'TC901']);
  assert.equal(caseOf(main, 'TC902').status, 'PENDING');
  assert.equal(caseOf(a.body.runId, 'TC901').retryOf, main);
  assert.ok(!store.activeFeatures.has(feature) && !redoQueues.has(feature) && !pausedFeatures.has(feature));
});

test('two redos queued together both run, in order, before the held loop resumes', async () => {
  calls.length = 0;
  for (const k of Object.keys(gates)) delete gates[k];
  for (const k of Object.keys(verdicts)) delete verdicts[k];
  holdCases.add('TC903');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC903, 'TC903 running');          // TC901, TC902 finished
  await post('/tests/pause', { feature });
  const a = await redo(['TC901'], 'one');
  const b = await redo(['TC902'], 'two');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  gates.TC903();
  await finish(a.body.runId); await finish(b.body.runId);
  assert.deepEqual(calls.map(c => `${c.id}:${c.hint}`), ['TC901:', 'TC902:', 'TC903:', 'TC901:one', 'TC902:two']);
  await post('/tests/resume', { feature });
  await finish(main);
  assert.equal(calls.at(-1).id, 'TC904');
  assert.equal(caseOf(main, 'TC901').retries[0].runId, a.body.runId);
  assert.equal(caseOf(main, 'TC902').retries[0].runId, b.body.runId);
});

test('paused on the last case: the redo still runs before the feature ends', async () => {
  calls.length = 0;
  for (const k of Object.keys(gates)) delete gates[k];
  holdCases.add('TC904');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC904, 'TC904 running');
  await post('/tests/pause', { feature });
  const a = await redo(['TC901'], 'late');
  assert.equal(a.status, 200);
  gates.TC904();
  await finish(a.body.runId); await finish(main);
  assert.equal(calls.at(-1).id, 'TC901');
  assert.ok(!store.activeFeatures.has(feature) && !pausedFeatures.has(feature));
});
