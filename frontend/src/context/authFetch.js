/**
 * Installs a global fetch() interceptor that attaches the Cognito access
 * token to every same-origin /api/* request.
 *
 * Why patch window.fetch instead of updating each call site: the codebase
 * has raw `fetch('/api/...')` calls in useApi.js plus several page/component
 * files (EditorPage, GenerateModal, TcEvidencePanel, AnalysisPage). A single
 * interceptor guarantees every current AND future call site is covered
 * without hunting down each one — the alternative is a fetch wrapper that's
 * easy to forget to use in a new file.
 *
 * No-ops entirely when auth isn't configured (authRequired() false) or the
 * request isn't same-origin /api/* — WS connections attach their own token
 * separately (see useWebSocket.js / EditorPage.jsx), since a native
 * WebSocket can't carry custom headers.
 */
import { authRequired } from './AuthContext'

let installed = false
let tokenGetter = null // async () => string | null, set by AuthProvider

export function setAuthTokenGetter(fn) {
  tokenGetter = fn
}

/**
 * Build a /ws URL with the Cognito access token attached as a query param.
 * A native browser WebSocket can't set an Authorization header, so the
 * token has to ride in the URL — the backend reads it off the upgrade
 * request's query string (see backend/src/services/websocket.js) and
 * verifies it before accepting the connection. Resolves to a token-less URL
 * when auth isn't configured.
 */
export async function buildAuthedWsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${proto}//${location.host}${path}`
  if (!authRequired() || !tokenGetter) return base
  const token = await tokenGetter()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export function installAuthFetch() {
  if (installed || !authRequired()) return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const isApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)

    if (!isApiCall || !tokenGetter) {
      return originalFetch(input, init)
    }

    const token = await tokenGetter()
    if (!token) {
      return originalFetch(input, init)
    }

    const headers = new Headers(init.headers || {})
    headers.set('Authorization', `Bearer ${token}`)
    return originalFetch(input, { ...init, headers })
  }
}
