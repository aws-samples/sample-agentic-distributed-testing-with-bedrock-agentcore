import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep the test away from the real state directory.
const dir = mkdtempSync(join(tmpdir(), 'toolsstatus-'));
process.env.SQLITE_DB_PATH = join(dir, 'data.db');
process.env.CONFIG_PATH = join(dir, 'config.json');

const { default: express } = await import('express');
const { default: toolRoutes } = await import('../src/routes/tools.js');
const { config } = await import('../src/state/store.js');

let api, runtime, backendServer, health = { status: 'ok', browserCanReadFiles: true };
const listen = (server) => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

before(async () => {
  runtime = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(health)); });
  process.env.LOCAL_RUNTIME_URL = `http://127.0.0.1:${await listen(runtime)}`;
  const app = express();
  app.use('/api', toolRoutes);
  backendServer = http.createServer(app);
  api = `http://127.0.0.1:${await listen(backendServer)}/api`;
});
after(async () => { runtime.close(); backendServer.close(); await new Promise(r => setTimeout(r, 100)); rmSync(dir, { recursive: true, force: true }); });

const status = () => fetch(`${api}/config/tools/status`).then(r => r.json());

test('local mode: reports what the runtime says about file access', async () => {
  config.agentMode = 'local';
  health = { status: 'ok', browserCanReadFiles: true };
  assert.equal((await status()).browserCanReadFiles, true);
  health = { status: 'ok', browserCanReadFiles: false };
  assert.equal((await status()).browserCanReadFiles, false);
});

test('unknown when the runtime says nothing or is not local', async () => {
  config.agentMode = 'local';
  health = { status: 'ok' };
  assert.equal((await status()).browserCanReadFiles, null, 'an older runtime without the field');
  config.agentMode = 'agentcore';
  health = { status: 'ok', browserCanReadFiles: true };
  assert.equal((await status()).browserCanReadFiles, null, 'AgentCore: the browser is a separate machine');
});
