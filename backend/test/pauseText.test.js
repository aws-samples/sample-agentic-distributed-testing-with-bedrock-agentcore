import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseLabel, formatElapsed } from '../../frontend/src/utils/pauseText.mjs';

const t0 = Date.parse('2026-01-01T10:00:00Z');

test('formatElapsed gives m:ss and never goes negative', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(161000), '2:41');
  assert.equal(formatElapsed(-5000), '0:00');
});

test('a pending pause names the running case and how long it has run', () => {
  const info = { state: 'pausing', after: 'TC003', caseStartedAt: '2026-01-01T09:57:19Z' };
  assert.equal(pauseLabel(info, t0), 'Pausing after TC003 · running 2:41');
  assert.equal(pauseLabel({ state: 'pausing' }, t0), 'Pausing after the current case');
});

test('a hold says Paused with how long it has held', () => {
  assert.equal(pauseLabel({ state: 'paused', heldSince: '2026-01-01T09:59:48Z' }, t0), 'Paused 0:12');
  assert.equal(pauseLabel({ state: 'paused' }, t0), 'Paused');
  assert.equal(pauseLabel(undefined, t0), '');
});
