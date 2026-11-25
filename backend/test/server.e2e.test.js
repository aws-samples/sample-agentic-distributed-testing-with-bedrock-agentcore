// Starts the real backend on a free port with a throwaway database and checks the
// issue's acceptance points over HTTP. config.json is not written: no config route that saves is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function start(env) {
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), 'atr-'));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, HOST: '', API_KEY: '', PORT: String(port), SQLITE_DB_PATH: path.join(dir, 'data.db'), AGENTCORE_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/abc', AGENT_MODE: 'agentcore', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100 && !out.includes('Agentic Test Runner backend'); i++) await new Promise(r => setTimeout(r, 100));
  return { port, child, log: () => out, stop: () => child.kill() };
}

test('default start binds to loopback only; health has no ARN or account id', async () => {
  const s = await start({});
  try {
    assert.match(s.log(), /127\.0\.0\.1:\d+/);
    const health = await (await fetch(`http://127.0.0.1:${s.port}/api/health`)).json();
    assert.equal(health.runtimeConfigured, true);
    assert.ok(!('runtimeArn' in health));
    assert.ok(!JSON.stringify(health).includes('123456789012'));
    const auth = await (await fetch(`http://127.0.0.1:${s.port}/api/config/auth`)).json();
    assert.ok(auth.accounts.every(a => a.password !== 'PASSWORD' && a.passwordSet));
    const env = await (await fetch(`http://127.0.0.1:${s.port}/api/config/env`)).json();
    assert.ok(Array.isArray(env.variables));
    const bad = await fetch(`http://127.0.0.1:${s.port}/api/config/target-url`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'file:///etc/passwd' }) });
    assert.equal(bad.status, 400);
  } finally { s.stop(); }
});

test('HOST=0.0.0.0 without a key warns and refuses mutating calls', async () => {
  const s = await start({ HOST: '0.0.0.0' });
  try {
    assert.match(s.log(), /WARNING: no API_KEY/);
    const r = await fetch(`http://127.0.0.1:${s.port}/api/config/model`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"model":"x"}' });
    assert.equal(r.status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/config`)).status, 200);
  } finally { s.stop(); }
});
