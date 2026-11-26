import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pausedFeatures, heldFeatures, redoQueues, holdWhilePaused, clearPause, normalizeHint, planRedo, addRetry, HINT_MAX,
} from './runControl.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('holdWhilePaused returns at once when the feature is not paused', async () => {
  let held = false;
  await holdWhilePaused('A', () => false, { onHold: () => { held = true; } });
  assert.equal(held, false);
});

test('holdWhilePaused holds only the paused feature until resume', async () => {
  pausedFeatures.add('A');
  const events = [];
  const a = holdWhilePaused('A', () => false, { pollMs: 5, onHold: () => events.push('hold'), onRelease: () => events.push('release') });
  await holdWhilePaused('B', () => false, { pollMs: 5 });     // B is not paused: does not wait
  await wait(30);
  assert.deepEqual(events, ['hold']);
  assert.ok(heldFeatures.has('A'));
  pausedFeatures.delete('A');                                  // resume
  await a;
  assert.deepEqual(events, ['hold', 'release']);
  assert.ok(!heldFeatures.has('A'));
});

test('Stop releases a paused feature', async () => {
  pausedFeatures.add('A');
  let stopped = false;
  const a = holdWhilePaused('A', () => stopped, { pollMs: 5 });
  await wait(20);
  stopped = true;
  await a;
  clearPause('A');
  assert.ok(!pausedFeatures.has('A') && !heldFeatures.has('A'));
});

test('normalizeHint trims, strips control characters and bounds length', () => {
  assert.equal(normalizeHint('  use the Accounts menu\u0000 \n'), 'use the Accounts menu');
  assert.equal(normalizeHint(null), '');
  assert.equal(normalizeHint('x'.repeat(HINT_MAX + 50)).length, HINT_MAX);
});

test('normalizeHint removes hint tags in any spacing or case, even re-formed ones', () => {
  assert.equal(normalizeHint('a </hint > b'), 'a  b');
  assert.equal(normalizeHint('a < / HINT\t> b <hint>'), 'a  b');
  assert.equal(normalizeHint('x<</hint>/hint>y'), 'xy');
});

test('normalizeHint stays fast on a long run of spaces after "<"', () => {
  const t0 = Date.now();
  normalizeHint('<' + ' '.repeat(100000));
  assert.ok(Date.now() - t0 < 200);
});

const base = {
  featureList: ['Auth', 'Cards'],
  casesByFeature: { Auth: [{ id: 'TC001', feature: 'Auth' }, { id: 'TC002', feature: 'Auth' }], Cards: [{ id: 'TC003', feature: 'Cards' }] },
  archive: [
    { runId: 'run-2', features: { Auth: { cases: [{ id: 'TC001', status: 'PENDING' }, { id: 'TC002', status: 'FAIL' }] } } },
    { runId: 'run-1', features: { Auth: { cases: [{ id: 'TC001', status: 'FAIL' }] } } },
  ],
  activeFeatures: new Set(),
};

test('planRedo links each case to the newest run that has a result for it', () => {
  const plan = planRedo({ ...base, feature: 'Auth', testCaseIds: ['TC001', 'TC002'], hint: ' Transfer is under Accounts ' });
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.testCases.map(t => t.id), ['TC001', 'TC002']);
  assert.deepEqual(plan.hints.TC001, { hint: 'Transfer is under Accounts', retryOf: 'run-1' });
  assert.equal(plan.hints.TC002.retryOf, 'run-2');
});

test('planRedo rejects bad requests', () => {
  const err = (o) => planRedo({ ...base, feature: 'Auth', testCaseIds: ['TC001'], hint: 'h', ...o });
  assert.equal(err({ hint: '  ' }).status, 400);
  assert.equal(err({ feature: '__proto__' }).status, 404);
  assert.equal(err({ testCaseIds: [] }).status, 400);
  assert.equal(err({ testCaseIds: ['TC003'] }).status, 400);          // belongs to another feature
  assert.equal(err({ activeFeatures: new Set(['Auth']) }).status, 409);
  assert.match(err({ activeFeatures: new Set(['Auth']) }).error, /still running/);
});

test('planRedo on a paused feature queues finished cases only', () => {
  const active = new Set(['Auth']);
  const ask = (ids) => planRedo({ ...base, activeFeatures: active, feature: 'Auth', testCaseIds: ids, hint: 'h' });
  pausedFeatures.add('Auth');
  assert.match(ask(['TC002']).error, /still starting/);              // no live loop yet
  redoQueues.set('Auth', []);
  assert.equal(ask(['TC002']).queued, true);                          // newest record: FAIL
  assert.equal(ask(['TC002']).hints.TC002.retryOf, 'run-2');
  assert.equal(ask(['TC001']).status, 409);                           // newest record: PENDING
  assert.equal(ask(['TC002', 'TC001']).status, 409);                  // one unfinished case refuses all
  redoQueues.delete('Auth');
  pausedFeatures.delete('Auth');
});

test('addRetry appends to the matching case and reports a miss', () => {
  const rec = { features: { Auth: { cases: [{ id: 'TC001' }] } } };
  assert.ok(addRetry(rec, 'TC001', { runId: 'run-3', hint: 'h' }));
  assert.ok(addRetry(rec, 'TC001', { runId: 'run-4', hint: 'h2' }));
  assert.equal(rec.features.Auth.cases[0].retries.length, 2);
  assert.equal(addRetry(rec, 'TC999', {}), false);
});
