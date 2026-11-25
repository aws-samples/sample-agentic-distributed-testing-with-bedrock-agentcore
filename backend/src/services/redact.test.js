import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactSecrets, REDACTED, MIN_SECRET_LENGTH } from './redact.js';

test('redactSecrets masks every occurrence of each secret', () => {
  const out = redactSecrets('typed hunter2 then hunter2 and tok-123', ['hunter2', 'tok-123']);
  assert.equal(out, `typed ${REDACTED} then ${REDACTED} and ${REDACTED}`);
});

test('redactSecrets ignores empty secrets and handles non-strings', () => {
  assert.equal(redactSecrets('plain text', ['', null, undefined]), 'plain text');
  assert.equal(redactSecrets(undefined, ['x']), '');
});

test('redactSecrets masks the longer secret first so no tail is left', () => {
  assert.equal(redactSecrets('pass12345', ['pass123', 'pass12345']), REDACTED);
});

test('redactSecrets treats secrets as literal text, not patterns', () => {
  assert.equal(redactSecrets('a.b*c+d and axbbcxd', ['a.b*c+d']), `${REDACTED} and axbbcxd`);
});

test('redactSecrets skips secrets shorter than 6 characters', () => {
  assert.equal(redactSecrets('the pin 1234 and the word pass', ['1234', 'pass']), 'the pin 1234 and the word pass');
  assert.equal(redactSecrets('abcdef', ['abcdef']), REDACTED);
});

test('the frontend short-secret warning uses the same minimum length', () => {
  const src = readFileSync(new URL('../../../frontend/src/utils/secrets.js', import.meta.url), 'utf8');
  assert.equal(Number(src.match(/MIN_SECRET_LENGTH = (\d+)/)[1]), MIN_SECRET_LENGTH);
});
