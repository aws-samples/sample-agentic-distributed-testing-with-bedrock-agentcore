/**
 * Network exposure and API access control.
 *
 * - HOST: the interface the backend binds to. Defaults to 127.0.0.1 so a fresh
 *   install is reachable from this machine only. Set HOST=0.0.0.0 (or an address)
 *   to opt in to remote access.
 * - API_KEY: a shared secret sent as the `X-API-Key` header. Enforced whenever it
 *   is set. Cognito (middleware/auth.js) is the alternative.
 * - CORS_ORIGINS: comma-separated extra browser origins allowed to call the API
 *   cross-origin. The UI itself is same-origin (nginx / the Vite proxy) and needs none.
 *
 * Bound to a non-loopback HOST with neither Cognito nor an API key, read calls
 * still work and every mutating call (POST/PUT/PATCH/DELETE) is refused.
 */
import { timingSafeEqual } from 'crypto';

export const HOST = (process.env.HOST || '127.0.0.1').trim();
export const API_KEY = process.env.API_KEY || '';

export function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}
export const exposed = !isLoopbackHost(HOST);

const DEFAULT_ORIGINS = ['localhost', '127.0.0.1'].flatMap(h => ['5173', '5175'].map(p => `http://${h}:${p}`));
export function parseOrigins(csv) {
  return new Set([...DEFAULT_ORIGINS, ...String(csv || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)]);
}
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

// `cors` option: grant CORS only to listed origins. A request with no Origin header
// (same-origin, curl) gets no CORS headers, and does not need them.
export const corsOptions = {
  origin: (origin, cb) => cb(null, !!origin && allowedOrigins.has(origin)),
};

export function keyMatches(provided, expected = API_KEY) {
  if (!expected || typeof provided !== 'string') return false;
  // shortcut: a length mismatch returns early, so the key's length (not its content) can leak.
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express gate for /api. `cognito` is middleware/auth.js's requireAuth and
 * `cognitoEnabled` its authEnabled flag; they are parameters so the gate can be tested alone.
 */
export function apiGate({ cognito, cognitoEnabled, apiKey = API_KEY, isExposed = exposed }) {
  return (req, res, next) => {
    if (req.path === '/health') return next();
    if (apiKey && keyMatches(req.get('x-api-key'), apiKey)) return next();
    if (cognitoEnabled) return cognito(req, res, next);
    if (apiKey) return res.status(401).json({ error: 'Missing or invalid X-API-Key' });
    if (isExposed && !SAFE_METHODS.has(req.method)) {
      return res.status(403).json({ error: 'Refused: the backend is bound to a non-loopback HOST with no API_KEY or Cognito configured, so changes are disabled. Set API_KEY.' });
    }
    next();
  };
}

/**
 * WebSocket handshake check (raw http request). Returns null to accept, or an HTTP
 * status to reject with. A page on another origin must not be able to open the
 * socket from a visitor's browser and read screenshots and results.
 */
export function wsHandshakeStatus(req, { cognitoEnabled, tokenOk, apiKey = API_KEY, origins = allowedOrigins }) {
  const origin = req.headers.origin;
  if (origin && !origins.has(origin) && !sameHost(origin, req.headers.host)) return 403;
  if (apiKey && keyMatches(req.headers['x-api-key'], apiKey)) return null;
  if (cognitoEnabled) return tokenOk ? null : 401;
  return apiKey ? 401 : null;
}

// Origin's host equals the Host header's host (port ignored: nginx forwards Host without it).
function sameHost(origin, hostHeader) {
  try { return new URL(origin).hostname === new URL(`http://${hostHeader}`).hostname; } catch { return false; }
}

export function logStartupSecurity(authEnabled) {
  if (exposed) console.warn(`[security] Listening on ${HOST}, not loopback: other machines can reach the API.`);
  if (exposed && !API_KEY && !authEnabled) {
    console.warn('[security] WARNING: no API_KEY and no Cognito configured. Mutating API calls are refused until you set API_KEY.');
  }
  if (API_KEY) console.log('[security] X-API-Key required on /api/* (except /api/health)');
}
