import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const TIMEOUT_MS = 5000;   // whole check, all redirect hops included
const MAX_REDIRECTS = 5;

// The hostname is resolved once here, checked, and the request then connects to
// that exact address, so a second DNS answer (rebinding) cannot change the target.
// Loopback and private ranges stay allowed (the app under test is often local);
// link-local is blocked because it hosts the cloud instance-metadata service.
// BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d, including the hex form URL
// produces) against its IPv4 rules; the third rule is the AWS IPv6 metadata range.
const blocked = new net.BlockList();
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet(['fd00', 'ec2', ''].join(':') + ':', 32, 'ipv6');
export function isLinkLocal(ip) {
  return blocked.check(ip, net.isIPv4(ip) ? 'ipv4' : 'ipv6');
}

// dns.lookup ignores AbortSignal, so race it against the signal.
function abortable(promise, signal) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const fail = () => reject(signal.reason);
      if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
    }),
  ]);
}

async function resolveAllowed(url, signal) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https URLs can be checked'), { reason: 'Only http and https URLs can be checked' });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await abortable(dns.lookup(host, { all: true }), signal);
  if (addrs.some(a => isLinkLocal(a.address))) {
    const reason = 'Link-local and cloud-metadata addresses are not allowed';
    throw Object.assign(new Error(reason), { reason });
  }
  return { host, address: addrs[0].address };
}

// One GET to the pre-resolved address. The response body is never read.
function requestOnce(url, { host, address }, signal) {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      host: address,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Host: url.host },
      servername: net.isIP(host) ? undefined : host, // SNI and certificate check use the hostname, not the IP
      agent: false,
      signal,
    }, (res) => {
      res.destroy();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on('error', reject);
    req.end();
  });
}

function describeError(e) {
  if (e.reason) return e.reason;
  const code = e.cause?.code || e.code;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return `Timed out after ${TIMEOUT_MS / 1000}s`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed: host not found';
  if (code === 'ECONNREFUSED') return 'Connection refused: nothing is listening on that host and port';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'Connection timed out';
  if (code === 'ECONNRESET') return 'Connection reset by the server';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Host or network unreachable';
  if (/CERT|SSL|TLS|SELF_SIGNED/i.test(String(code) + (e.cause?.message || ''))) return `TLS error: ${e.cause?.message || code}`;
  return `Request failed: ${(e.cause?.message || e.message || 'unknown error').slice(0, 120)}`;
}

// GET the URL and report reachability. Redirects are followed manually (each hop
// re-validated); the response body is never read or returned.
export async function checkTargetUrl(rawUrl, { timeoutMs = TIMEOUT_MS } = {}) {
  const base = { checkedFrom: 'backend' };
  let url;
  try { url = new URL(String(rawUrl).trim()); } catch { return { ...base, ok: false, reason: 'Invalid URL' }; }
  const signal = AbortSignal.timeout(timeoutMs);
  const started = Date.now();
  try {
    let res;
    for (let hop = 0; ; hop++) {
      const target = await resolveAllowed(url, signal);
      res = await requestOnce(url, target, signal);
      const loc = res.location;
      if (res.status < 300 || res.status >= 400 || !loc) break;
      if (hop >= MAX_REDIRECTS) return { ...base, ok: false, status: res.status, responseTimeMs: Date.now() - started, finalUrl: url.href, reason: `Too many redirects (more than ${MAX_REDIRECTS})` };
      url = new URL(loc, url);
    }
    const ok = res.status < 400;
    return {
      ...base, ok, status: res.status, responseTimeMs: Date.now() - started, finalUrl: url.href,
      ...(ok ? {} : { reason: `Server responded with HTTP ${res.status}` }),
    };
  } catch (e) {
    return { ...base, ok: false, responseTimeMs: Date.now() - started, reason: describeError(e) };
  }
}
