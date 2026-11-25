import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, REDACTED } from './redact.js';

test('redactSecrets masks every occurrence of each secret', () => {
  const out = redactSecrets('typed hunter2 then hunter2 and tok-123', ['hunter2', 'tok-123']);
  assert.equal(out, `typed ${REDACTED} then ${REDACTED} and ${REDACTED}`);
});

test('redactSecrets ignores empty secrets and handles non-strings', () => {
  assert.equal(redactSecrets('plain text', ['', null, undefined]), 'plain text');
  assert.equal(redactSecrets(undefined, ['x']), '');
});

test('redactSecrets masks the longer secret first so no tail is left', () => {
  assert.equal(redactSecrets('pass12345', ['pass', 'pass12345']), REDACTED);
});

test('redactSecrets treats secrets as literal text, not patterns', () => {
  assert.equal(redactSecrets('a.b*c and axbbc', ['a.b*c']), `${REDACTED} and axbbc`);
});
