import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { extractJsonObject } from '../src/services/aiJson.js';

// The route imports the store, which opens a database: use a throwaway one.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-json-test-'));
process.env.SQLITE_DB_PATH = path.join(tmp, 'test.db');

const TC = { title: 'Pay in full', given: ['a card'], when: ['I pay'], then: ['balance is zero'], summary: 'ok' };
const J = JSON.stringify(TC);

test('plain object', () => assert.deepEqual(extractJsonObject(J).value, TC));

test('object, then a note that has braces of its own', () => {
  assert.deepEqual(extractJsonObject(`${J}\n\nNote: I used {placeholders} for the amount.`).value, TC);
});

test('object, then a second object: the first one wins', () => {
  assert.deepEqual(extractJsonObject(`${J}\n${JSON.stringify({ title: 'other' })}`).value, TC);
});

test('fenced ```json block with text around it', () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n' + J + '\n```\nHope that helps {really}.').value, TC);
});

test('fence without a language tag', () => {
  assert.deepEqual(extractJsonObject('```\n' + J + '\n```').value, TC);
});

test('prose with braces before the object is skipped', () => {
  assert.deepEqual(extractJsonObject(`Using {balance} as the key. ${J}`).value, TC);
});

test('braces inside a string value do not end the object', () => {
  const tc = { ...TC, then: ['Then the page shows {balance}', 'and a lone } and { too'] };
  assert.deepEqual(extractJsonObject(JSON.stringify(tc) + ' trailing }').value, tc);
});

test('escaped quote and backslash inside a string', () => {
  const tc = { ...TC, title: 'Type "Enter" then \\ done {x}', when: ['say "hi}"'] };
  assert.deepEqual(extractJsonObject(JSON.stringify(tc) + '\n{"more": 1}').value, tc);
});

test('no JSON at all', () => {
  for (const t of ['', '   ', 'Sorry, I cannot help with that.', 'only a closing } brace', null, undefined]) {
    assert.ok(extractJsonObject(t).error, String(t));
  }
});

test('truncated JSON is refused, not half-read', () => {
  const cut = J.slice(0, J.length - 15);
  assert.match(extractJsonObject(cut).error, /cut off/);
  // an inner object of a cut-off reply must not be returned as the answer
  assert.ok(extractJsonObject('{"title":"x","meta":{"a":1},"when":["unfinished').error);
});

test('a brace pair that is not JSON gives an error, not an exception', () => {
  assert.ok(extractJsonObject('{not json}').error);
  assert.ok(extractJsonObject('{"a":1,}').error);
});

// ── the route: a model reply that cannot be read answers 422 with a message the dialog can show ──
let server, base, reply;
before(async () => {
  BedrockRuntimeClient.prototype.send = async () => {
    if (reply instanceof Error) throw reply;
    return { output: { message: { content: [{ text: reply }] } } };
  };
  const { default: generateRoutes } = await import('../src/routes/generate.js');
  const app = express();
  app.use(express.json());
  app.use('/api', generateRoutes);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const draft = () => fetch(base + '/generate/edit-with-ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'create', instruction: 'pay the card in full', feature: { name: 'Cards' } }),
});

test('route: object followed by a note with braces is drafted (was a 502)', async () => {
  reply = `${J}\n\nNote: replace {amount} before running.`;
  const r = await draft();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).enhanced.title, 'Pay in full');
});

test('route: unreadable reply answers 422 with a clear message', async () => {
  for (const bad of ['I could not do that.', J.slice(0, 40), '{"title":"x"}']) {
    reply = bad;
    const r = await draft();
    assert.equal(r.status, 422, bad);
    assert.equal((await r.json()).error, 'The AI reply could not be read as a test case. Try again.');
  }
});

test('route: a failed call to the model is still 502', async () => {
  reply = new Error('ThrottlingException');
  const r = await draft();
  assert.equal(r.status, 502);
});
