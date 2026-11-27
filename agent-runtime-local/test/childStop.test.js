import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { trackRun, killSession, killChildOnAbort } from '../src/childStop.js';

// A stand-in for POST / run_test: starts a child that never ends, the way a hung
// opencode would, wired with trackRun + killChildOnAbort exactly as index.js does.
const alive = new Set();
const exits = [];
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const run = trackRun('F', res);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  alive.add(child);
  child.on('exit', (code, signal) => { alive.delete(child); exits.push(signal); run.done(); res.end(); });
  killChildOnAbort(child, run.signal);
  res.write('data: {}\n\n');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
after(() => { for (const c of alive) c.kill('SIGKILL'); srv.close(); });

const until = async (cond, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};

test('a hung child is killed when the request is aborted, and a retry runs only one child', async () => {
  const ctrl = new AbortController();
  const resp = await fetch(url, { method: 'POST', signal: ctrl.signal });
  await resp.body.getReader().read(); // first chunk: the child is running
  assert.equal(alive.size, 1);

  ctrl.abort(); // backend per-case timeout
  await until(() => alive.size === 0);
  assert.equal(exits.at(-1), 'SIGTERM');

  // The retry: exactly one child.
  const retry = await fetch(url, { method: 'POST' });
  await retry.body.getReader().read();
  assert.equal(alive.size, 1);

  // Backend's /kill { sessionName } stops it too.
  assert.equal(killSession('F'), true);
  await until(() => alive.size === 0);
  assert.equal(killSession('F'), false);
});

test('a new run for the same session stops the one before it', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const fakeRes = { on() {}, off() {}, writableFinished: false };
  const first = trackRun('G', fakeRes);
  killChildOnAbort(child, first.signal);
  const second = trackRun('G', fakeRes);
  const [, signal] = await once(child, 'exit');
  assert.equal(signal, 'SIGTERM');
  assert.equal(second.signal.aborted, false);
  second.done();
});

test('a finished response does not abort the run', async () => {
  const res = new (await import('node:events')).EventEmitter();
  res.writableFinished = true;
  const run = trackRun('H', res);
  res.emit('close');
  assert.equal(run.signal.aborted, false);
  run.done();
});
