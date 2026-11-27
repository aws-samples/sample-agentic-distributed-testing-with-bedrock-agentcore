import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCaseWithAttempts } from '../src/services/caseAttempts.js';

const fast = { backoffMs: 1, throttleBackoffMs: 1, pollMs: 5 };

test('a verdict on the first try is one attempt', async () => {
  const r = await runCaseWithAttempts(async () => ({ status: 'FAIL', reason: 'wrong page' }), { ...fast, maxRetries: 2 });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.attempts.length, 1);
});

test('a hung call is aborted at the timeout and recorded as ERROR: timeout', async () => {
  let sawAbort = false;
  const hang = (signal) => { signal.addEventListener('abort', () => { sawAbort = true; }); return new Promise(() => {}); };
  const t0 = Date.now();
  const r = await runCaseWithAttempts(hang, { ...fast, timeoutMs: 50, maxRetries: 0 });
  assert.equal(r.status, 'ERROR');
  assert.match(r.reason, /^ERROR: timeout/);
  assert.ok(sawAbort, 'signal was aborted');
  assert.ok(Date.now() - t0 < 1000);
});

test('ERROR is retried up to maxRetries and every attempt is kept', async () => {
  let calls = 0;
  const r = await runCaseWithAttempts(async () => { calls++; return { status: 'ERROR', reason: `boom ${calls}` }; }, { ...fast, maxRetries: 2 });
  assert.equal(calls, 3);
  assert.equal(r.status, 'ERROR');
  assert.deepEqual(r.attempts.map(a => [a.n, a.status, a.reason]), [[1, 'ERROR', 'boom 1'], [2, 'ERROR', 'boom 2'], [3, 'ERROR', 'boom 3']]);
});

test('a retry that gets a verdict ends with that verdict', async () => {
  let calls = 0;
  const r = await runCaseWithAttempts(async () => (++calls === 1 ? { status: 'ERROR', reason: 'throttled', throttled: true } : { status: 'PASS', reason: 'ok' }), { ...fast, maxRetries: 3 });
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.attempts.map(a => a.status), ['ERROR', 'PASS']);
});

test('PASS and FAIL are never retried', async () => {
  for (const status of ['PASS', 'FAIL']) {
    let calls = 0;
    await runCaseWithAttempts(async () => { calls++; return { status, reason: '' }; }, { ...fast, maxRetries: 3 });
    assert.equal(calls, 1, status);
  }
});

test('a thrown error is ERROR, not FAIL', async () => {
  const r = await runCaseWithAttempts(async () => { throw new Error('S3 down'); }, { ...fast, maxRetries: 0 });
  assert.equal(r.status, 'ERROR');
  assert.match(r.reason, /S3 down/);
});

test('Stop aborts a running call and marks it SKIPPED without retry', async () => {
  let stopped = false;
  let calls = 0;
  setTimeout(() => { stopped = true; }, 30);
  const r = await runCaseWithAttempts((signal) => { calls++; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))); },
    { ...fast, timeoutMs: 10_000, maxRetries: 3, isStopped: () => stopped });
  assert.equal(r.status, 'SKIPPED');
  assert.equal(calls, 1);
});
