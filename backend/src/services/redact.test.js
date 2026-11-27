import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactSecrets, createRedactingBuffer, REDACTED, MIN_SECRET_LENGTH } from './redact.js';
import { createSseParser } from './sseParser.js';

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

// Streams `pieces` through a redacting buffer and returns what it let out, piece by piece.
function stream(pieces, secrets, opts) {
  const out = [];
  const b = createRedactingBuffer(() => secrets, (t) => out.push(t), opts);
  for (const p of pieces) b.push(p);
  b.flush();
  return out;
}
const SECRET = 'Sup3rSecret!';
// No piece that was let out may show any 4+ character part of a secret.
function assertNoPart(out, secrets) {
  for (const s of secrets) for (let i = 0; i + 4 <= s.length; i++) {
    for (const o of out) assert.ok(!o.replaceAll(REDACTED, '').includes(s.slice(i, i + 4)), `"${o}" shows "${s.slice(i, i + 4)}" of a secret`);
  }
}

test('buffer: a secret streamed in 2 pieces is masked', () => {
  const out = stream(['typing Sup3r', 'Secret! now'], [SECRET]);
  assert.equal(out.join(''), `typing ${REDACTED} now`);
  assertNoPart(out, [SECRET]);
});

test('buffer: a secret streamed in 1-character pieces is masked', () => {
  const text = `Log in.\nI type ${SECRET} in the box. Then ${SECRET} again.\nDone`;
  const out = stream([...text], [SECRET]);
  assert.equal(out.join(''), text.replaceAll(SECRET, REDACTED));
  assertNoPart(out, [SECRET]);
  assert.ok(out.length > 1, 'text still comes out per line or sentence, not only at the end');
});

test('buffer: a secret split across a size-cap flush or a sentence end is held back whole', () => {
  // Size cap: the 20-character cap falls inside the secret.
  const capped = stream(['0123456789abcd Sup3r', 'Secret! tail text here'], [SECRET], { flushAt: 20 });
  assert.equal(capped.join(''), `0123456789abcd ${REDACTED} tail text here`);
  assert.equal(capped[0], '0123456789abcd ');
  assertNoPart(capped, [SECRET]);
  // Sentence end right before the secret's start.
  const sentence = stream(['ok. Sup3r', 'Secret! x'], [SECRET]);
  assert.equal(sentence[0], 'ok. ');
  assert.equal(sentence.join(''), `ok. ${REDACTED} x`);
  // A secret that itself holds a sentence end or a newline.
  const odd = 'ab. cd\nef';
  assert.equal(stream([...`x ${odd} y`], [odd]).join(''), `x ${REDACTED} y`);
  assertNoPart(stream([...`x ${odd} y`], [odd]), [odd]);
});

test('buffer: two secrets where one is a prefix of the other leave no tail', () => {
  const secrets = ['pass123', 'pass12345'];
  const text = 'a pass12345 b pass123 c pass1234';
  for (const pieces of [[text], [...text], ['a pass12', '345 b pass1', '23 c pass1234']]) {
    assert.equal(stream(pieces, secrets).join(''), `a ${REDACTED} b ${REDACTED} c ${REDACTED}4`, JSON.stringify(pieces));
  }
});

test('buffer: a secret at the very end of the stream is masked on flush', () => {
  const out = stream(['the password is Sup3', 'rSecret', '!'], [SECRET]);
  assert.equal(out.join(''), `the password is ${REDACTED}`);
  assertNoPart(out, [SECRET]);
});

test('verdict reason: masked before it is cut to the last 200 characters', () => {
  const redact = (t) => redactSecrets(t, [SECRET]);
  // The 200-character cut lands 4 characters into the secret.
  const text = `x ${SECRET}` + 'y'.repeat(200 - SECRET.length + 4 - ' failed'.length) + ' failed';
  assert.ok(text.slice(-200).startsWith(SECRET.slice(4)));   // cutting first would show the last 8 characters
  const parser = createSseParser({ screenshot() {}, step() {} }, { redact });
  parser.feedLine(`data: ${JSON.stringify({ event: { contentBlockDelta: { delta: { text } } } })}`);
  const { reason } = parser.finish();
  assert.ok(!reason.includes(SECRET.slice(4, 8)), reason);
  assert.equal(reason.length, 200);
  // An assert_fail reason is masked too.
  const p = createSseParser({ screenshot() {}, step() {} }, { redact });
  p.feedLine(`data: ${JSON.stringify({ event: { contentBlockStart: { start: { toolUse: { name: 'assert_fail' } } } } })}`);
  p.feedLine(`data: ${JSON.stringify({ event: { contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ reason: `typed ${SECRET}` }) } } } } })}`);
  assert.equal(p.finish().reason, `typed ${REDACTED}`);
});
