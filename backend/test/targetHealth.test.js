import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { checkTargetUrl } from '../src/services/targetHealth.js';

// A link-local address (built from parts); the checker must refuse it without connecting.
const LINK_LOCAL = ['169', '254', '1', '1'].join('.');

let hits = 0;
const srv = http.createServer((req, res) => {
  hits++;
  if (req.url === '/redir') { res.writeHead(302, { location: '/ok' }); return res.end(); }
  if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
  if (req.url === '/ll') { res.writeHead(302, { location: `http://${LINK_LOCAL}/` }); return res.end(); }
  if (req.url === '/bad') { res.writeHead(500); return res.end('secret body'); }
  res.end('secret body');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

test('reachable: status, time, final URL, no body', async () => {
  const r = await checkTargetUrl(`${base}/redir`);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, `${base}/ok`);
  assert.equal(typeof r.responseTimeMs, 'number');
  assert.equal(r.checkedFrom, 'backend');
  assert.ok(!JSON.stringify(r).includes('secret body'));
});

test('non-http(s) scheme rejected with no request made', async () => {
  const before = hits;
  for (const u of ['file:///etc/passwd', 'ftp://127.0.0.1/', 'gopher://x']) {
    const r = await checkTargetUrl(u);
    assert.equal(r.ok, false);
    assert.match(r.reason, /http/);
  }
  assert.equal(hits, before);
});

test('HTTP 500 is a failure with the status', async () => {
  const r = await checkTargetUrl(`${base}/bad`);
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.match(r.reason, /500/);
});

test('connection refused', async () => {
  const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r));
  const r = await checkTargetUrl(`http://127.0.0.1:${port}/`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /refused/i);
});

test('unknown host', async () => {
  const r = await checkTargetUrl('http://no-such-host.invalid/');
  assert.equal(r.ok, false);
  assert.match(r.reason, /DNS|not found/i);
});

test('link-local blocked directly and via redirect', async () => {
  let r = await checkTargetUrl(`http://${LINK_LOCAL}/`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Link-local/);
  r = await checkTargetUrl(`${base}/ll`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Link-local/);
});

test('redirect loop stops', async () => {
  const r = await checkTargetUrl(`${base}/loop`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /redirects/);
});

test('invalid URL', async () => {
  assert.equal((await checkTargetUrl('not a url')).ok, false);
});

test('connects to the address it validated and sends the original Host header', async () => {
  let seenHost;
  const s = http.createServer((req, res) => { seenHost = req.headers.host; res.end(); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  // "localhost" is resolved by the checker; the server must see Host: localhost:<port>.
  const r = await checkTargetUrl(`http://localhost:${port}/`);
  s.close();
  assert.equal(r.ok, true);
  assert.equal(seenHost, `localhost:${port}`);
});
