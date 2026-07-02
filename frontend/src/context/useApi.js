async function apiCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export function useApi() {
  return {
    getConfig: () => apiCall('GET', '/api/config'),
    getHealth: () => apiCall('GET', '/api/health'),
    getModuleCases: (mod) => apiCall('GET', `/api/modules/${encodeURIComponent(mod)}/cases`),
    addModule: (name) => apiCall('POST', '/api/modules', { name }),
    removeModule: (mod) => apiCall('DELETE', `/api/modules/${encodeURIComponent(mod)}`),
    addCase: (mod, tc) => apiCall('POST', `/api/modules/${encodeURIComponent(mod)}/cases`, tc),
    updateCase: (tcId, body) => apiCall('PATCH', `/api/cases/${encodeURIComponent(tcId)}`, body),
    deleteCase: (tcId) => apiCall('DELETE', `/api/cases/${encodeURIComponent(tcId)}`),
    connectSessions: (modules) => apiCall('POST', '/api/sessions/connect', { modules }),
    resetSessions: () => apiCall('POST', '/api/sessions/reset', {}),
    runTests: (testCases) => apiCall('POST', '/api/tests/run', { testCases }),
    stopRun: () => apiCall('POST', '/api/tests/stop'),
    updateModel: (model) => apiCall('PATCH', '/api/config/model', { model }),
    updateMode: (mode) => apiCall('PATCH', '/api/config/mode', { mode }),
    updateTargetUrl: (url) => apiCall('PATCH', '/api/config/target-url', { url }),
    updateRegions: (regions) => apiCall('PATCH', '/api/config/regions', regions),
    getKnownRegions: () => apiCall('GET', '/api/config/regions/known'),
    checkModelHealth: (model) => apiCall('POST', '/api/model/health-check', { model }),
    requestAnalysis: (testCase, stepResults, failureDetails) =>
      apiCall('POST', '/api/analysis/bug-fix', { testCase, stepResults, failureDetails }),
    exportYaml: async () => {
      const res = await fetch('/api/export')
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.text()
    },
    importYaml: async (yamlText) => {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/yaml' },
        body: yamlText,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || res.statusText)
      }
      return res.json()
    },
  }
}
