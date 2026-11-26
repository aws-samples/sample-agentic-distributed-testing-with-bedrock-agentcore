import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
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

test('IPv4-mapped IPv6 and AWS IPv6 metadata-range addresses are blocked', async () => {
  const mapped = `::ffff:${LINK_LOCAL}`;               // URL normalises this to a hex form
  const awsV6 = ['fd00', 'ec2', '', '1'].join(':');    // inside the /32
  for (const host of [mapped, awsV6, 'fe80::1']) {
    const r = await checkTargetUrl(`http://[${host}]/`);
    assert.equal(r.ok, false, host);
    assert.match(r.reason, /Link-local/, host);
  }
  const ok = await checkTargetUrl(`http://[::ffff:127.0.0.1]:${srv.address().port}/`);
  assert.equal(ok.ok, true); // mapped loopback stays allowed
});

test('a hung DNS lookup is cut off by the timeout', async () => {
  const m = mock.method(dns, 'lookup', () => new Promise(() => {}));
  const t = Date.now();
  const r = await checkTargetUrl('http://hung.example/', { timeoutMs: 200 });
  m.mock.restore();
  assert.equal(r.ok, false);
  assert.match(r.reason, /Timed out/);
  assert.ok(Date.now() - t < 2000);
});

// --- #72: every validated address is tried in resolver order ---------------

// Stub the resolver for one hostname, record every TCP connect, and optionally
// make connects to some addresses hang (never complete) to exercise the timeout.
function stubResolver(addresses, { hang = [] } = {}) {
  const lookup = mock.method(dns, 'lookup', async () =>
    addresses.map(address => ({ address, family: net.isIPv6(address) ? 6 : 4 })));
  const tried = [];
  const orig = net.Socket.prototype.connect;
  const connect = mock.method(net.Socket.prototype, 'connect', function (...args) {
    const opts = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (opts && typeof opts === 'object' && opts.host) {
      tried.push(opts.host);
      if (hang.includes(opts.host)) { this.connecting = true; return this; } // SYN never answered
    }
    return orig.apply(this, args);
  });
  return { tried, restore: () => { lookup.mock.restore(); connect.mock.restore(); } };
}

async function hostServer() {
  const seen = [];
  const s = http.createServer((req, res) => { seen.push(req.headers.host); res.end(); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { s, seen, port: s.address().port };
}

async function closedPort() {
  const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r));
  return port;
}

test('::1 listed before 127.0.0.1: falls through to IPv4, keeps Host header', async () => {
  const { s, seen, port } = await hostServer();
  const st = stubResolver(['::1', '127.0.0.1']);
  const r = await checkTargetUrl(`http://localhost:${port}/`);
  st.restore(); s.close();
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(st.tried, ['::1', '127.0.0.1']);
  assert.deepEqual(seen, [`localhost:${port}`]);
});

test('all addresses refused: reports the last error', async () => {
  const port = await closedPort();
  const st = stubResolver(['::1', '127.0.0.1']);
  const r = await checkTargetUrl(`http://localhost:${port}/`);
  st.restore();
  assert.equal(r.ok, false);
  assert.deepEqual(st.tried, ['::1', '127.0.0.1']);
  assert.match(r.reason, /refused/i);
});

test('first address hangs on connect: next one is tried inside the timeout', async () => {
  const { s, port } = await hostServer();
  const st = stubResolver(['127.0.0.3', '127.0.0.1'], { hang: ['127.0.0.3'] });
  const t = Date.now();
  const r = await checkTargetUrl(`http://app.test:${port}/`, { timeoutMs: 600 });
  st.restore(); s.close();
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(st.tried, ['127.0.0.3', '127.0.0.1']);
  assert.ok(Date.now() - t < 600, 'stayed inside the overall timeout');
});

test('every address hangs: one overall timeout, not one per address', async () => {
  const st = stubResolver(['127.0.0.3', '127.0.0.4', '127.0.0.5'], { hang: ['127.0.0.3', '127.0.0.4', '127.0.0.5'] });
  const t = Date.now();
  const r = await checkTargetUrl('http://app.test:81/', { timeoutMs: 300 });
  st.restore();
  assert.equal(r.ok, false);
  assert.equal(st.tried.length, 3);
  assert.match(r.reason, /Timed out|timed out/);
  assert.ok(Date.now() - t < 800);
});

test('a resolved blocked address is never connected to', async () => {
  const st = stubResolver([LINK_LOCAL]);
  const r = await checkTargetUrl('http://meta.test/');
  st.restore();
  assert.equal(r.ok, false);
  assert.match(r.reason, /Link-local/);
  assert.deepEqual(st.tried, []);
});

test('mix of allowed and blocked addresses: whole host refused, nothing tried', async () => {
  for (const order of [['127.0.0.1', LINK_LOCAL], [LINK_LOCAL, '127.0.0.1'], ['::1', 'fe80::1', '127.0.0.1']]) {
    const st = stubResolver(order);
    const r = await checkTargetUrl(`http://mixed.test:${srv.address().port}/`);
    st.restore();
    assert.equal(r.ok, false, order.join(','));
    assert.match(r.reason, /Link-local/);
    assert.deepEqual(st.tried, [], order.join(','));
  }
});

test('single address: one connect, no retry', async () => {
  const { s, port } = await hostServer();
  const st = stubResolver(['127.0.0.1']);
  const r = await checkTargetUrl(`http://one.test:${port}/`);
  st.restore(); s.close();
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(st.tried, ['127.0.0.1']);
});

test('HTTP error from the first address is final: no second request', async () => {
  const s = http.createServer((req, res) => { res.writeHead(500); res.end(); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const st = stubResolver(['127.0.0.1', '127.0.0.2']);
  const r = await checkTargetUrl(`http://two.test:${s.address().port}/`);
  st.restore(); s.close();
  assert.equal(r.status, 500);
  assert.deepEqual(st.tried, ['127.0.0.1']);
});
