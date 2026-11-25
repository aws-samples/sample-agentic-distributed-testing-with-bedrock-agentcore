import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCiRouter } from '../src/routes/ci.js';
import { ciVerdict, toJUnit, toHtml, esc } from '../src/services/reports.js';

const record = (over = {}) => ({
  runId: 'run-1700000000000', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:05:00Z',
  stopped: false, targetUrl: 'http://app',
  summary: { total: 3, pass: 1, fail: 1, pending: 1 },
  features: { 'Log<in>': { cases: [
    { id: 'TC001', title: 'ok', status: 'PASS', reason: '' },
    { id: 'TC002', title: 'bad "quote" & <b>', status: 'FAIL', reason: 'boom <script>\u0001' },
    { id: 'TC003', title: 'never', status: 'PENDING', reason: '' },
  ] } },
  ...over,
});

test('esc escapes markup and strips control chars', () => {
  assert.equal(esc('<a href="x">&\'\u0001'), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
});

test('ciVerdict exit codes', () => {
  assert.deepEqual(ciVerdict(record({ completedAt: null })).exitCode, null);
  assert.equal(ciVerdict(record()).exitCode, 1);
  assert.equal(ciVerdict(record({ summary: { total: 1, pass: 1, fail: 0, pending: 0 } })).exitCode, 0);
  assert.equal(ciVerdict(record({ summary: { total: 2, pass: 1, fail: 0, pending: 1 } })).exitCode, 2);
  assert.equal(ciVerdict(record({ summary: { total: 1, pass: 1, fail: 0, pending: 0 }, stopped: true })).exitCode, 2);
});

test('toJUnit reports failures and skips, escaped', () => {
  const xml = toJUnit(record());
  assert.match(xml, /<testsuite name="Log&lt;in&gt;" tests="3" failures="1" errors="0" skipped="1"/);
  assert.match(xml, /<failure message="boom &lt;script&gt;">boom &lt;script&gt;<\/failure>/);
  assert.match(xml, /<skipped message="PENDING"\/>/);
  assert.ok(!xml.includes('<b>'));
});

test('toHtml escapes user text', () => {
  const html = toHtml(record());
  assert.ok(!html.includes('<script>'));
  assert.match(html, /bad &quot;quote&quot; &amp; &lt;b&gt;/);
});

async function withServer(opts, fn) {
  const started = [];
  const archive = [record({ runId: 'run-5' })];
  const app = express();
  app.use(express.json());
  app.use('/api/ci', createCiRouter({
    startRun: tcs => { started.push(tcs); return 'run-99'; },
    runArchive: archive,
    testCasesByFeature: { A: [{ id: 'TC001' }, { id: 'TC002' }], B: [{ id: 'TC003' }] },
    isBusy: () => !!opts.busy,
    getSecret: () => opts.secret ?? 's3cret',
  }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/ci`;
  const call = (path, { method = 'GET', body, auth = 'Bearer s3cret' } = {}) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  try { await fn(call, started); } finally { srv.close(); }
}

test('disabled without a configured secret', () => withServer({ secret: '' }, async call => {
  assert.equal((await call('/runs/run-5')).status, 503);
}));

test('rejects missing and wrong credentials', () => withServer({}, async call => {
  assert.equal((await call('/runs/run-5', { auth: null })).status, 401);
  assert.equal((await call('/runs/run-5', { auth: 'Bearer nope' })).status, 401);
}));

test('trigger selects by feature / ids / all and validates input', () => withServer({}, async (call, started) => {
  let r = await call('/runs', { method: 'POST', body: { features: ['A'] } });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).runId, 'run-99');
  assert.deepEqual(started[0].map(t => t.id), ['TC001', 'TC002']);
  await call('/runs', { method: 'POST', body: { testCaseIds: ['TC003'] } });
  assert.deepEqual(started[1].map(t => t.id), ['TC003']);
  await call('/runs', { method: 'POST', body: { all: true } });
  assert.equal(started[2].length, 3);
  assert.equal((await call('/runs', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/runs', { method: 'POST', body: { features: '__proto__' } })).status, 400);
  assert.equal((await call('/runs', { method: 'POST', body: { features: ['__proto__'] } })).status, 404);
}));

test('trigger refuses while a run is active', () => withServer({ busy: true }, async call => {
  assert.equal((await call('/runs', { method: 'POST', body: { all: true } })).status, 409);
}));

test('status and report endpoints', () => withServer({}, async call => {
  const s = await (await call('/runs/run-5')).json();
  assert.equal(s.exitCode, 1);
  const x = await call('/runs/run-5/junit.xml');
  assert.match(x.headers.get('content-type'), /xml/);
  assert.match(await x.text(), /<testsuites/);
  assert.match(await (await call('/runs/run-5/report.html')).text(), /<!doctype html>/);
  assert.equal((await call('/runs/run-6')).status, 404);
  assert.equal((await call('/runs/__proto__')).status, 404);
}));
