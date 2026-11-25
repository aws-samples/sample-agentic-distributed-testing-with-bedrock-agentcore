import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 5000;   // whole check, all redirect hops included
const MAX_REDIRECTS = 5;

// shortcut: the address is checked at lookup time, then fetch resolves again, so
// DNS rebinding can slip past; upgrade to a pinned-IP dispatcher if this is ever
// exposed beyond a trusted, authenticated operator.
// Loopback and private ranges stay allowed (the app under test is often local);
// link-local is blocked because it hosts the cloud instance-metadata service.
function isLinkLocal(ip) {
  if (net.isIPv4(ip)) return ip.startsWith('169.254.');
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(v)) return v.startsWith('169.254.');
  return /^fe[89ab]/.test(v);
}

async function assertAllowed(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https URLs can be checked'), { reason: 'Only http and https URLs can be checked' });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some(a => isLinkLocal(a.address))) {
    const reason = 'Link-local addresses (169.254.x.x, fe80::) are not allowed';
    throw Object.assign(new Error(reason), { reason });
  }
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
export async function checkTargetUrl(rawUrl) {
  const base = { checkedFrom: 'backend' };
  let url;
  try { url = new URL(String(rawUrl).trim()); } catch { return { ...base, ok: false, reason: 'Invalid URL' }; }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const started = Date.now();
  try {
    let res;
    for (let hop = 0; ; hop++) {
      await assertAllowed(url);
      res = await fetch(url, { method: 'GET', redirect: 'manual', signal });
      res.body?.cancel().catch(() => {});
      const loc = res.headers.get('location');
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
