import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFromAgentOutput, isThrottle } from '../src/services/verdict.js';

test('assert_pass / assert_fail are the only verdicts', () => {
  assert.deepEqual(verdictFromAgentOutput({ passed: true, reason: '{"reason":"Dashboard shown"}' }), { status: 'PASS', reason: 'Dashboard shown' });
  assert.deepEqual(verdictFromAgentOutput({ passed: false, reason: 'raw reason' }), { status: 'FAIL', reason: 'raw reason' });
});

test('text without an assert call is ERROR, never PASS', () => {
  const texts = [
    'Verification failed: not successful',
    'The test passed successfully and was verified.',
    'PASS',
    '{"passed": true, "reason": "looks fine"}',
    '{"passed":false,"reason":"No verdict from agent"}',
    '{"error":"Browser session failed: boom"}',
  ];
  for (const t of texts) {
    const v = verdictFromAgentOutput(null, t);
    assert.equal(v.status, 'ERROR', t);
    assert.match(v.reason, /^No verdict from agent/);
  }
});

test('empty output is ERROR', () => {
  assert.equal(verdictFromAgentOutput(null, '').status, 'ERROR');
  assert.equal(verdictFromAgentOutput(null, '   \n').status, 'ERROR');
  assert.equal(verdictFromAgentOutput(null).status, 'ERROR');
});

test('isThrottle spots AgentCore throttling', () => {
  assert.ok(isThrottle({ name: 'ThrottlingException', message: 'Rate exceeded' }));
  assert.ok(isThrottle({ $metadata: { httpStatusCode: 429 } }));
  assert.ok(!isThrottle(new Error('ECONNRESET')));
  assert.ok(!isThrottle(undefined));
});
