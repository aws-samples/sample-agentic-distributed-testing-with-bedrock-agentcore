/**
 * Cognito access-token verification for /api/* routes.
 *
 * Enabled only when COGNITO_USER_POOL_ID + COGNITO_CLIENT_ID are set (i.e.
 * when the deploying Terraform stack had enable_cognito_auth = true — see
 * terraform/testrunner/cognito.tf). Absent those env vars, requireAuth() is
 * a no-op passthrough, so local dev (docker-compose, no Cognito) is
 * unaffected.
 *
 * Verification uses aws-jwt-verify (AWS's own maintained library): it
 * fetches the user pool's JWKS, caches it, and checks signature + issuer +
 * audience + expiry — no hand-rolled crypto. The frontend attaches the
 * Cognito *access* token (not the ID token) as `Authorization: Bearer <jwt>`
 * on every API call; we verify that token type here to match.
 *
 * The ALB health check (GET /api/health) has no browser session and no
 * token — it's excluded from this middleware in index.js, not here, so this
 * file stays a single-purpose "verify or reject" gate.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

export const authEnabled = !!(USER_POOL_ID && CLIENT_ID);

const verifier = authEnabled
  ? CognitoJwtVerifier.create({
      userPoolId: USER_POOL_ID,
      tokenUse: 'access',
      clientId: CLIENT_ID,
    })
  : null;

export async function requireAuth(req, res, next) {
  if (!authEnabled) return next(); // Cognito not configured — local/dev mode

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = await verifier.verify(token);
    req.user = { sub: payload.sub, email: payload.email, username: payload.username };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Same verification as requireAuth, reshaped as a boolean check for the
 * WebSocket upgrade path (services/websocket.js) — a raw socket has no
 * Express res to write a JSON error onto, so the caller just needs true/false
 * to decide whether to accept or reject the handshake.
 */
export async function verifyWsToken(token) {
  if (!authEnabled) return true;
  if (!token) return false;
  try {
    await verifier.verify(token);
    return true;
  } catch {
    return false;
  }
}
