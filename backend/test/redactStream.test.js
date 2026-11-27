// A secret the agent streams in pieces must not show in the step feed, the live log, the websocket
// replay, the verdict reason or the saved run history. Real router, run loop and websocket against a
// fake local runtime (one HTTP server) standing in for the agent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocket } from 'ws';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-stream-'));
process.env.SQLITE_DB_PATH = path.join(dir, 'data.db');

const SECRET = 'Sup3rSecret!';
const OTHER = 'tok-9f8e7d6c';        // a secret context variable
// The agent narrates both secrets in small pieces, then ends with a reason whose last-200 cut lands
// inside the secret. Pieces are sent one SSE event each; the stream pauses at `gate` for the replay check.
const narration = ['Typing Sup3r', 'Secret! into ', 'the password box. The token is tok-', '9f8e', '7d6c', '\n', 'Now chec'];
const reasonText = `x ${SECRET}` + 'y'.repeat(200 - SECRET.length + 4 - 6) + ' done.';   // cut 4 characters into SECRET
const sse = (ev) => `data: ${JSON.stringify({ event: ev })}\n\n`;
let release;
const gate = new Promise(r => { release = r; });
const runtime = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    const p = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (p.action === 'init') return res.end(sse({ screenshot: { data: 'AAAA' } }));
    for (const t of narration) res.write(sse({ contentBlockDelta: { delta: { text: t } } }));
    await gate;
    res.write(sse({ contentBlockDelta: { delta: { text: `king. ${reasonText}` } } }));
    for (const ch of SECRET) res.write(sse({ contentBlockDelta: { delta: { text: ch } } }));   // a secret at the very end
    res.end();
  });
});
await new Promise(r => runtime.listen(0, '127.0.0.1', r));
process.env.LOCAL_RUNTIME_URL = `http://127.0.0.1:${runtime.address().port}`;

const store = await import('../src/state/store.js');
const { default: testRoutes } = await import('../src/routes/tests.js');
const { initWebSocket } = await import('../src/services/websocket.js');
const { stopScreenPoller } = await import('../src/services/sessions.js');
const { runArchive } = await import('../src/state/archive.js');

store.config.agentMode = 'local';
store.config.auth = { enabled: true, accounts: [{ role: 'user', username: 'u', password: SECRET }] };
store.config.envVars = [{ name: 'TOKEN', value: OTHER, description: '', secret: true }];
const app = express();
app.use(express.json());
app.use('/api', testRoutes);
const api = http.createServer(app);
initWebSocket(api);
await new Promise(r => api.listen(0, '127.0.0.1', r));
const base = `127.0.0.1:${api.address().port}`;

const feature = 'RS';
const tc = { id: 'TC951', feature, title: 'TC951', given: [], when: [], then: [] };
store.featureList.push(feature);
store.testCasesByFeature[feature] = [tc];

const listen = () => new Promise((resolve) => {
  const msgs = [];
  const ws = new WebSocket(`ws://${base}/ws`);
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('open', () => resolve({ ws, msgs }));
});
const until = async (fn, what) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(`timed out: ${what}`); };
// No 4+ character part of either secret may show in `text`.
const leaks = (text) => [SECRET, OTHER].flatMap(s => Array.from({ length: s.length - 3 }, (_, i) => s.slice(i, i + 4))).filter(p => text.includes(p));

after(() => {
  stopScreenPoller(feature);
  runtime.close(); api.close();
  fs.rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 50).unref();   // the store keeps a DB handle open
});

test('a secret streamed in pieces is masked in the step feed, live log, replay, reason and run history', async () => {
  const live = await listen();
  const r = await fetch(`http://${base}/api/tests/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testCases: [tc] }) });
  const { runId } = await r.json();
  await until(() => live.msgs.some(m => m.type === 'tc_log' && m.entry.msg.includes('token')), 'first line logged');

  const late = await listen();   // a viewer that connects mid-case gets the replay
  await until(() => late.msgs.some(m => m.type === 'tc_log_replay'), 'replay');
  release();
  await until(() => !store.activeRunPromises.has(runId), 'run done');

  const steps = live.msgs.filter(m => m.type === 'step_detail' && m.kind === 'text').map(m => m.action);
  const logs = live.msgs.filter(m => m.type === 'tc_log').map(m => m.entry.msg);
  const replay = late.msgs.find(m => m.type === 'tc_log_replay').logs.map(e => e.msg);
  const result = live.msgs.find(m => m.type === 'test_result');
  const saved = runArchive.find(x => x.runId === runId).features[feature].cases[0];

  for (const [where, list] of [['step feed', steps], ['live log', logs], ['replay', replay], ['reason', [result.reason]], ['history reason', [saved.reason]], ['history log', saved.logs.map(e => e.msg)]]) {
    assert.ok(list.length > 0, `${where} is empty`);
    for (const t of list) assert.deepEqual(leaks(t), [], `${where}: ${t}`);
  }
  assert.equal(steps.join(''), `Typing [redacted] into the password box. The token is [redacted]\nNow checking. ${reasonText.replace(SECRET, '[redacted]')}[redacted]`);
  assert.ok(replay.join('').includes('The token is [redacted]'));
  assert.equal(result.reason.length, 200);
});
