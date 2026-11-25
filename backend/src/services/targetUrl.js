/**
 * Target URL validation. The URL is driven by a real browser (the agent runtime),
 * so only http and https are accepted. Private and link-local addresses are allowed
 * (the app under test is often on a private network) but come back with a warning.
 * shortcut: judged on the literal host only, no DNS lookup, so a name that resolves to a private address is not flagged.
 */
export function checkTargetUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are allowed' };
  }
  const kind = addressKind(u.hostname);
  const warning = kind === 'link-local'
    ? 'This is a link-local address (the cloud metadata range). Make sure the browser agent should reach it.'
    : kind === 'private' ? 'This is a private network address, reachable only from where the agent runs.' : undefined;
  return { ok: true, ...(warning ? { warning } : {}) };
}

function addressKind(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/) || mappedV4(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 169 && b === 254) return 'link-local';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    return null;
  }
  if (/^fe[89ab][0-9a-f]:/.test(h)) return 'link-local';
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return 'private';
  return null;
}

// URL parsing turns ::ffff:10.0.0.1 into ::ffff:a00:1
function mappedV4(h) {
  const m = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
  return [null, hi >> 8, hi & 255, lo >> 8, lo & 255];
}
