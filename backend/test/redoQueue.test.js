// Redo queue, cancel, pause state and last frames: the real router and run loop against a fake local
// runtime (one HTTP server) standing in for the agent.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redo-queue-'));
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
    res.write(sse({ screenshot: { data: `frame-${id}` } }));
    res.end(sse({ contentBlockDelta: { delta: { text: JSON.stringify({ passed, reason: `${id} ${passed ? 'ok' : 'bad'}` }) } } }));
  });
});
await new Promise(r => runtime.listen(0, '127.0.0.1', r));
process.env.LOCAL_RUNTIME_URL = `http://127.0.0.1:${runtime.address().port}`;

const store = await import('../src/state/store.js');
const { default: testRoutes } = await import('../src/routes/tests.js');
const { stopScreenPoller } = await import('../src/services/sessions.js');
const { pausedFeatures, heldFeatures, redoQueues, listQueuedRedos, pauseState } = await import('../src/services/runControl.js');
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
const tcs = ['TC911', 'TC912', 'TC913', 'TC914'].map(id => ({ id, feature, title: id, given: [], when: [], then: [] }));

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

const reset = () => { calls.length = 0; for (const k of Object.keys(gates)) delete gates[k]; for (const k of Object.keys(verdicts)) delete verdicts[k]; };
const get = async (p) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() }; };

test('a redo asked while the feature runs (not paused) goes before the remaining cases and carries its hint', async () => {
  reset();
  verdicts.TC911 = false;
  holdCases.add('TC912');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC912, 'TC912 running');                           // TC911 finished (FAIL)

  assert.equal((await redo(['TC912'])).status, 409);                         // running now
  assert.equal((await redo(['TC913'])).status, 409);                         // not reached yet
  verdicts.TC911 = true;
  const r = await redo(['TC911'], 'under the Accounts menu');
  assert.equal(r.status, 200);
  assert.deepEqual(listQueuedRedos().map(q => [q.feature, q.testId, q.hint]), [[feature, 'TC911', 'under the Accounts menu']]);
  assert.equal((await redo(['TC911'], 'again')).status, 409);                // already queued

  gates.TC912();
  await finish(r.body.runId); await finish(main);
  assert.deepEqual(calls.map(c => c.id), ['TC911', 'TC912', 'TC911', 'TC913', 'TC914']);   // redo right after the case in progress
  assert.equal(calls[2].hint, 'under the Accounts menu');
  assert.equal(calls[3].hint, '');
  assert.equal(caseOf(r.body.runId, 'TC911').retryOf, main);
  assert.equal(caseOf(main, 'TC911').retries[0].runId, r.body.runId);
  assert.equal(caseOf(main, 'TC911').status, 'FAIL');                        // the earlier result is kept
  assert.equal(caseOf(r.body.runId, 'TC911').status, 'PASS');
  assert.equal(listQueuedRedos().length, 0);
});

test('two redos run in the order asked, both before the remaining cases', async () => {
  reset();
  holdCases.add('TC913');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC913, 'TC913 running');
  const a = await redo(['TC912'], 'one');
  const b = await redo(['TC911'], 'two');
  gates.TC913();
  await finish(a.body.runId); await finish(b.body.runId); await finish(main);
  assert.deepEqual(calls.map(c => `${c.id}:${c.hint}`), ['TC911:', 'TC912:', 'TC913:', 'TC912:one', 'TC911:two', 'TC914:']);
});

test('a queued redo can be cancelled before it starts; the earlier result loses its retry link', async () => {
  reset();
  holdCases.add('TC912');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC912, 'TC912 running');
  const r = await redo(['TC911'], 'never mind');
  assert.equal(caseOf(main, 'TC911').retries.length, 1);

  const bad = await post('/tests/redo/cancel', { feature, runId: r.body.runId, testCaseId: 'TC913' });
  assert.equal(bad.status, 409);                                              // not queued
  const ok = await post('/tests/redo/cancel', { feature, runId: r.body.runId, testCaseId: 'TC911' });
  assert.equal(ok.status, 200);
  assert.equal((await post('/tests/redo/cancel', { feature, runId: r.body.runId, testCaseId: 'TC911' })).status, 409);   // already gone
  assert.equal(listQueuedRedos().length, 0);
  assert.equal(caseOf(main, 'TC911').retries, undefined);

  gates.TC912();
  await finish(r.body.runId); await finish(main);
  assert.deepEqual(calls.map(c => c.id), ['TC911', 'TC912', 'TC913', 'TC914']);   // the redo never ran
  assert.equal(caseOf(r.body.runId, 'TC911').status, 'PENDING');
  assert.equal(caseOf(r.body.runId, 'TC911').cancelled, true);
});

test('after a cancel the same case can be redone again', async () => {
  reset();
  holdCases.add('TC912');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC912, 'TC912 running');
  const first = await redo(['TC911'], 'first try');
  await post('/tests/redo/cancel', { feature, runId: first.body.runId, testCaseId: 'TC911' });
  const second = await redo(['TC911'], 'second try');
  assert.equal(second.status, 200);
  assert.equal(caseOf(second.body.runId, 'TC911').retryOf, main);              // the cancelled redo is not a result
  gates.TC912();
  await finish(second.body.runId); await finish(first.body.runId); await finish(main);
  assert.equal(calls.filter(c => c.id === 'TC911' && c.hint === 'second try').length, 1);
});

test('a queued redo that has started cannot be cancelled', async () => {
  reset();
  holdCases.add('TC912');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC912, 'TC912 running');
  holdCases.add('TC911');
  const r = await redo(['TC911'], 'go');
  gates.TC912();
  await until(() => gates.TC911, 'redo running');
  assert.equal((await post('/tests/redo/cancel', { feature, runId: r.body.runId, testCaseId: 'TC911' })).status, 409);
  gates.TC911();
  await finish(r.body.runId); await finish(main);
});

test('pause state names the running case; hold start is reported; the last case cannot be paused before', async () => {
  reset();
  holdCases.add('TC913');
  const { body: { runId: main } } = await post('/tests/run', { testCases: tcs });
  await until(() => gates.TC913, 'TC913 running');
  const p = await post('/tests/pause', { feature });
  assert.equal(p.status, 200);
  assert.equal(p.body.paused, true);
  assert.equal(p.body.holding, false);                                        // "pausing", not "paused" yet
  assert.equal(p.body.after, 'TC913');
  assert.ok(Date.parse(p.body.caseStartedAt) <= Date.now());
  gates.TC913();
  await until(() => heldFeatures.has(feature), 'held before TC914');
  const held = pauseState(feature);
  assert.equal(held.holding, true);
  assert.ok(held.heldSince);
  await post('/tests/resume', { feature });
  holdCases.add('TC914');
  await until(() => gates.TC914, 'TC914 running');
  const last = await post('/tests/pause', { feature });
  assert.equal(last.status, 409);
  assert.match(last.body.error, /TC914 is the last test case/);
  assert.ok(!pausedFeatures.has(feature));
  gates.TC914();
  await finish(main);
});

test('the last frame of a case is served for its row', async () => {
  const ok = await get('/tests/frame/TC911');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data, 'frame-TC911');
  assert.equal((await get('/tests/frame/__proto__')).status, 404);
  assert.equal((await get('/tests/frame/NOPE')).status, 404);
});
