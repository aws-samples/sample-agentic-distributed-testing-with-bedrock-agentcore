import test from 'node:test';
import assert from 'node:assert/strict';
import { createSseStream } from './sseParser.js';

const ev = (event) => `data: ${JSON.stringify({ event })}\n\n`;
const STREAM =
  ev({ contentBlockDelta: { delta: { text: 'Prüfe Überweisung 日本語 🚀 ok' } } }) +
  ev({ contentBlockStart: { start: { toolUse: { name: 'click' } } } }) +
  ev({ screenshot: { data: 'AAAA' } }) +
  ev({ contentBlockStart: { start: { toolUse: { name: 'assert_pass' } } } }) +
  ev({ contentBlockDelta: { delta: { toolUse: { input: '{"reason":"Dashboard 🚀 shown"}' } } } });
const BYTES = new TextEncoder().encode(STREAM);

function run(cuts) {
  const steps = [];
  const shots = [];
  const stream = createSseStream({ screenshot: (d) => shots.push(d), step: (a, k) => steps.push([a, k]) });
  let from = 0;
  for (const to of [...cuts, BYTES.length]) { stream.write(BYTES.slice(from, to)); from = to; }
  return { steps, shots, verdict: stream.end() };
}

const whole = run([]);

test('the stream parses to the expected steps, frame and verdict', () => {
  assert.deepEqual(whole.steps, [['Prüfe Überweisung 日本語 🚀 ok', 'text'], ['→ click', 'tool']]);
  assert.deepEqual(whole.shots, ['AAAA']);
  assert.deepEqual(whole.verdict, { passed: true, reason: 'Dashboard 🚀 shown' });
});

test('one byte per chunk gives the same result (splits inside UTF-8 characters and mid-line)', () => {
  assert.deepEqual(run(Array.from({ length: BYTES.length - 1 }, (_, i) => i + 1)), whole);
});

test('every single split point gives the same result', () => {
  for (let i = 1; i < BYTES.length; i++) assert.deepEqual(run([i]), whole, `split at byte ${i}`);
});

test('a last line without a trailing newline is still parsed on end()', () => {
  const stream = createSseStream({ screenshot() {}, step() {} });
  stream.write(new TextEncoder().encode(ev({ contentBlockStart: { start: { toolUse: { name: 'assert_fail' } } } }).trimEnd()));
  assert.equal(stream.end().passed, false);
});
