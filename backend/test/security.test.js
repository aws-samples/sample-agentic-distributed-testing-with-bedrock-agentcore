import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { isLoopbackHost, parseOrigins, apiGate, wsHandshakeStatus, keyMatches } from '../src/security.js';
import { checkTargetUrl } from '../src/services/targetUrl.js';
import { MASK, maskedAccounts, maskedEnvVars, resolveEnvVars } from '../src/services/secrets.js';

async function serve(app) {
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
function gatedApp(opts, corsOpts) {
  const app = express();
  if (corsOpts) app.use(cors(corsOpts));
  app.use('/api', apiGate({ cognitoEnabled: false, ...opts }));
  app.all('/api/*', (req, res) => res.json({ ok: true }));
  return app;
}

test('isLoopbackHost', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '::', '10.0.0.5', 'example.com']) assert.equal(isLoopbackHost(h), false, h);
});

test('gate: exposed without key refuses mutating calls, allows reads and health', async () => {
  const s = await serve(gatedApp({ apiKey: '', isExposed: true }));
  try {
    assert.equal((await fetch(`${s.base}/api/config`)).status, 200);
    assert.equal((await fetch(`${s.base}/api/config`, { method: 'PATCH' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/tests/run`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/health`, { method: 'POST' })).status, 200);
  } finally { s.close(); }
});

test('gate: loopback without key stays open', async () => {
  const s = await serve(gatedApp({ apiKey: '', isExposed: false }));
  try { assert.equal((await fetch(`${s.base}/api/config`, { method: 'PATCH' })).status, 200); } finally { s.close(); }
});

test('gate: with a key every non-health call needs it', async () => {
  const s = await serve(gatedApp({ apiKey: 'k-123', isExposed: true }));
  try {
    assert.equal((await fetch(`${s.base}/api/config`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/config`, { headers: { 'x-api-key': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${s.base}/api/config`, { method: 'PUT', headers: { 'x-api-key': 'k-123' } })).status, 200);
    assert.equal((await fetch(`${s.base}/api/health`)).status, 200);
  } finally { s.close(); }
});

test('keyMatches', () => {
  assert.equal(keyMatches('a', 'a'), true);
  assert.equal(keyMatches('a', 'b'), false);
  assert.equal(keyMatches(undefined, 'b'), false);
  assert.equal(keyMatches('', ''), false);
});

test('CORS: listed origin gets a grant, unlisted origin gets none', async () => {
  const origins = parseOrigins('https://ui.example.com/');
  const s = await serve(gatedApp({ apiKey: '', isExposed: false }, { origin: (o, cb) => cb(null, !!o && origins.has(o)) }));
  try {
    const get = (origin) => fetch(`${s.base}/api/config`, { headers: { origin } });
    assert.equal((await get('https://ui.example.com')).headers.get('access-control-allow-origin'), 'https://ui.example.com');
    assert.equal((await get('http://localhost:5173')).headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await get('https://evil.example')).headers.get('access-control-allow-origin'), null);
  } finally { s.close(); }
});

test('websocket handshake: foreign origin refused, same host and no origin accepted, key enforced', () => {
  const origins = parseOrigins('');
  const req = (origin, host = 'box.example:5175', key) => ({ headers: { origin, host, 'x-api-key': key } });
  const base = { cognitoEnabled: false, apiKey: '', origins };
  assert.equal(wsHandshakeStatus(req('https://evil.example'), base), 403);
  assert.equal(wsHandshakeStatus(req('http://box.example:5175'), base), null);
  assert.equal(wsHandshakeStatus(req(undefined), base), null);
  assert.equal(wsHandshakeStatus(req(undefined), { ...base, apiKey: 'k' }), 401);
  assert.equal(wsHandshakeStatus(req(undefined, undefined, 'k'), { ...base, apiKey: 'k' }), null);
  assert.equal(wsHandshakeStatus(req(undefined), { ...base, cognitoEnabled: true, tokenOk: false }), 401);
});

test('target URL: http/https only, warns on private and link-local', () => {
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.example', 'not a url']) assert.equal(checkTargetUrl(u).ok, false, u);
  assert.deepEqual(checkTargetUrl('https://example.com'), { ok: true });
  assert.deepEqual(checkTargetUrl('http://localhost:8020'), { ok: true });
  assert.match(checkTargetUrl('http://169.254.169.254/latest').warning, /link-local/);
  assert.match(checkTargetUrl('http://[fe80::1]/').warning, /link-local/);
  assert.match(checkTargetUrl('http://[::ffff:169.254.169.254]/').warning, /link-local/);
  for (const u of ['http://10.1.2.3', 'http://172.20.0.1', 'http://192.168.1.1', 'http://[fd00::1]/']) assert.match(checkTargetUrl(u).warning, /private/, u);
  assert.equal(checkTargetUrl('http://172.32.0.1').warning, undefined);
});

test('secrets are masked and MASK keeps the stored value', () => {
  const accounts = [{ role: 'admin', username: 'a', password: 'pw' }, { role: 'user', username: 'u', password: '' }];
  assert.deepEqual(maskedAccounts(accounts), [
    { role: 'admin', username: 'a', passwordSet: true, password: MASK },
    { role: 'user', username: 'u', passwordSet: false, password: '' },
  ]);
  assert.ok(!JSON.stringify(maskedAccounts(accounts)).includes('"pw"'));

  const stored = [{ name: 'TOKEN', value: 's3cret', description: '', secret: true }, { name: 'ENVNAME', value: 'qa', description: '', secret: false }];
  const out = maskedEnvVars(stored);
  assert.equal(out[0].value, MASK);
  assert.equal(out[0].valueSet, true);
  assert.equal(out[1].value, 'qa');

  assert.equal(resolveEnvVars([{ name: 'TOKEN', value: MASK, secret: true }], stored).list[0].value, 's3cret');
  assert.equal(resolveEnvVars([{ name: 'TOKEN', value: 'new', secret: true }], stored).list[0].value, 'new');
  assert.ok(resolveEnvVars([{ name: 'OTHER', value: MASK, secret: true }], stored).error);
  assert.ok(resolveEnvVars([{ name: '__proto__', value: MASK, secret: true }], stored).error);
});
