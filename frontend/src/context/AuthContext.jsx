import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { installAuthFetch, setAuthTokenGetter } from './authFetch'

/**
 * Cognito Hosted UI login via Authorization Code + PKCE — no client secret
 * in the browser bundle, which is the correct flow for a public SPA client
 * (see terraform/testrunner/cognito.tf, generate_secret = false).
 *
 * Wholly inert when VITE_COGNITO_* env vars are unset at build time (local
 * docker-compose dev, or any deployment with enable_cognito_auth = false):
 * authRequired() returns false, AuthGate renders children immediately, and
 * every consumer (useApi, useWebSocket) falls back to sending no token.
 */

const DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || ''
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || ''
const REDIRECT_URI = typeof window !== 'undefined' ? `${window.location.origin}/` : ''

export function authRequired() {
  return !!(DOMAIN && CLIENT_ID)
}

const STORAGE_KEY = 'testrunner_auth_tokens' // { access_token, id_token, refresh_token, expires_at }

function loadTokens() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}
function saveTokens(t) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t))
}
function clearTokens() {
  sessionStorage.removeItem(STORAGE_KEY)
}

// ─── PKCE helpers ──────────────────────────────────────────────────────────
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function sha256(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return base64url(new Uint8Array(digest))
}
function randomString(len = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return base64url(bytes)
}

const PKCE_VERIFIER_KEY = 'testrunner_pkce_verifier'

async function redirectToHostedUi() {
  const verifier = randomString()
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  const challenge = await sha256(verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.assign(`${DOMAIN}/oauth2/authorize?${params.toString()}`)
}

async function exchangeCodeForTokens(code) {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) || ''
  sessionStorage.removeItem(PKCE_VERIFIER_KEY)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const data = await res.json()
  return {
    access_token: data.access_token,
    id_token: data.id_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

async function refreshTokens(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  })
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data = await res.json()
  return {
    access_token: data.access_token,
    id_token: data.id_token,
    refresh_token: refreshToken, // refresh endpoint doesn't rotate it
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

// ─── Context ───────────────────────────────────────────────────────────────

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [tokens, setTokens] = useState(loadTokens)
  const [ready, setReady] = useState(!authRequired()) // true immediately if auth is off
  const [error, setError] = useState('')

  const login = useCallback(() => { redirectToHostedUi() }, [])

  const logout = useCallback(() => {
    clearTokens()
    setTokens(null)
    if (!authRequired()) return
    const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: REDIRECT_URI })
    window.location.assign(`${DOMAIN}/logout?${params.toString()}`)
  }, [])

  // Ensure the access token is fresh; refreshes in place if it's about to expire.
  // Call this before any API/WS use so callers never send a stale token.
  const getAccessToken = useCallback(async () => {
    if (!authRequired()) return null
    let t = tokens
    if (!t) return null
    if (t.expires_at - Date.now() < 60_000) { // refresh with 60s to spare
      try {
        t = await refreshTokens(t.refresh_token)
        saveTokens(t)
        setTokens(t)
      } catch {
        clearTokens()
        setTokens(null)
        return null
      }
    }
    return t.access_token
  }, [tokens])

  // Register this provider's getAccessToken with the global fetch
  // interceptor so every /api/* call (including ones this component tree
  // doesn't know about) picks up a fresh Bearer token automatically.
  useEffect(() => {
    setAuthTokenGetter(getAccessToken)
    installAuthFetch()
  }, [getAccessToken])

  // On mount: handle the Hosted UI redirect-back (?code=...), or verify we
  // already hold a session, or kick off login.
  useEffect(() => {
    if (!authRequired()) return

    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')

    if (code) {
      exchangeCodeForTokens(code)
        .then((t) => {
          saveTokens(t)
          setTokens(t)
          url.searchParams.delete('code')
          url.searchParams.delete('state')
          window.history.replaceState({}, '', url.pathname) // strip ?code from the address bar
          setReady(true)
        })
        .catch((e) => {
          setError(e.message)
          setReady(true)
        })
      return
    }

    if (!tokens) {
      redirectToHostedUi()
      return
    }

    setReady(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ tokens, ready, error, login, logout, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Wrap the app in this. Renders nothing (blank while redirecting, which is
 * the same UX as any Hosted-UI-gated app) until either auth is disabled or
 * a token exchange has completed.
 */
export function AuthGate({ children }) {
  const { ready, error } = useAuth()
  if (error) {
    return <div style={{ padding: 24, color: 'var(--red, #f85149)' }}>Login failed: {error}</div>
  }
  if (!ready) return null
  return children
}
