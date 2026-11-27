// A closed request (backend per-case timeout or Stop) must stop the child agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(50); }
  return false;
}

test('closing the request kills the opencode child', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-abort-'));
  const pidFile = join(dir, 'pid');
  // Fake opencode: record own pid, then hang. `exec` keeps the pid the runtime sees.
  writeFileSync(join(dir, 'opencode'), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 300\n`);
  chmodSync(join(dir, 'opencode'), 0o755);
  const port = 4300 + Math.floor(Math.random() * 500);
  const rt = spawn('node', [join(dirname(fileURLToPath(import.meta.url)), '../src/index.js')], {
    env: { ...process.env, PORT: String(port), CHROME_DEVTOOLS_URL: 'http://127.0.0.1:1', PATH: `${dir}:${process.env.PATH}` },
    stdio: 'ignore',
  });
  let pid;
  try {
    assert.ok(await until(async () => fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"health"}' }).then(r => r.ok, () => false)), 'runtime did not start');
    const ctrl = new AbortController();
    fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ action: 'run_test', sessionName: 't', targetUrl: 'http://example.test', testCase: { id: 'TC-1', title: 't', steps: [] } }),
    }).then(r => r.text()).catch(() => {});
    assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim()), 'child not started');
    pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(alive(pid));
    ctrl.abort(); // what the backend does on timeout
    assert.ok(await until(() => !alive(pid), 5000), 'child still running after request closed');
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    rt.kill('SIGKILL');
  }
});
