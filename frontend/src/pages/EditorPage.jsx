import { useState, useEffect, useRef } from 'react'
import jsyaml from 'js-yaml'
import NavBar from '../components/NavBar'
import FeaturePanel from '../components/FeaturePanel'
import FeatureModal from '../components/FeatureModal'
import TcEditor from '../components/TcEditor'
import EditWithAiModal from '../components/EditWithAiModal'
import AuthModal from '../components/AuthModal'
import ImportModal from '../components/ImportModal'
import { useApi } from '../context/useApi'
import Btn from '../components/Btn'
import Icon from '../components/Icon'
import { buildAuthedWsUrl } from '../context/authFetch'
import styles from './EditorPage.module.css'

// Test case ids are suite-wide (TC001, TC002, ...), not tied to a feature.
function nextTcId(allFeatures) {
  let max = 0
  for (const f of allFeatures) for (const t of f.testCases || []) {
    const m = /^TC(\d+)$/.exec(t.id || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `TC${String(max + 1).padStart(3, '0')}`
}

// What the Authentication button shows: is a login configured, and for how many accounts.
function summarizeAuth(a) {
  const count = (a?.accounts || []).filter(x => x.username).length
  return { enabled: !!a?.enabled, count }
}

function docForExport(doc) {
  return {
    ...doc,
    features: doc.features.map(m => ({
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      testCases: (m.testCases || []).map(tc => ({
        id: tc.id, scenario: tc.title,
        given: tc.given, when: tc.when, then: tc.then,
      })),
    })),
  }
}

export default function EditorPage() {
  const [doc, setDoc] = useState({ features: [] })
  const [selectedFeatIdx, setSelectedFeatIdx] = useState(null)
  const [selectedTcId, setSelectedTcId] = useState(null)
  const [expandedFeatNames, setExpandedFeatNames] = useState(new Set()) // tree expansion (independent of editing selection)
  const [searchQuery, setSearchQuery] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState({ msg: '', kind: '' })
  const [featModalOpen, setFeatModalOpen] = useState(false)
  const [editingFeatIdx, setEditingFeatIdx] = useState(null)
  const [addingToFeatIdx, setAddingToFeatIdx] = useState(null)   // feature the AI is drafting a new test case for
  const api = useApi()
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [targetUrl, setTargetUrl] = useState('')
  const [targetUrlDirty, setTargetUrlDirty] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authSummary, setAuthSummary] = useState({ enabled: false, count: 0 })   // for the button badge
  // Read-only mode while a test run is in progress
  const [activeFeatures, setActiveFeatures] = useState(new Set())
  const [anyRunningFromSnapshot, setAnyRunningFromSnapshot] = useState(false)
  const readOnly = activeFeatures.size > 0 || anyRunningFromSnapshot
  const initialLoadDoneRef = useRef(false)
  const saveTimerRef = useRef(null)
  let statusTimer = null

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const cfg = await res.json()
      setTargetUrl(cfg.targetUrl || '')
      setTargetUrlDirty(false)
      setAuthSummary(summarizeAuth(cfg.auth))
    } catch { /* ignore */ }
  }

  const saveTargetUrl = async () => {
    if (!targetUrl.trim()) {
      setStatusMsg('Target URL cannot be empty', 'err')
      return
    }
    try {
      new URL(targetUrl.trim())
    } catch {
      setStatusMsg('Invalid URL format', 'err')
      return
    }
    try {
      const res = await fetch('/api/config/target-url', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl.trim() }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setTargetUrlDirty(false)
      setStatusMsg('Target URL saved', 'ok')
    } catch (e) {
      setStatusMsg('Save failed: ' + e.message, 'err')
    }
  }

  const setStatusMsg = (msg, kind = '') => {
    clearTimeout(statusTimer)
    setStatus({ msg, kind })
    if (msg && kind !== 'err') {
      statusTimer = setTimeout(() => setStatus({ msg: '', kind: '' }), 4000)
    }
  }

  const loadFromBackend = async () => {
    setStatusMsg('Loading…')
    try {
      const res = await fetch('/api/export')
      const text = await res.text()
      const parsed = jsyaml.load(text) || { features: [] }
      const loaded = parsed
      if (!loaded.features) loaded.features = []
      // The file format says `scenario:`; the editor's state calls it `title`.
      for (const f of loaded.features) for (const tc of f.testCases || []) {
        if (tc.scenario !== undefined) { if (tc.title === undefined) tc.title = tc.scenario; delete tc.scenario }
      }
      setDoc(loaded)
      setDirty(false)
      // Pre-select the first feature and its first test case (if any exist)
      // so reloading the page doesn't land on an empty right panel.
      const firstFeat = loaded.features[0]
      const firstTc = firstFeat?.testCases?.[0]
      setSelectedFeatIdx(firstFeat ? 0 : null)
      if (firstFeat) setExpandedFeatNames(new Set([firstFeat.name]))
      setSelectedTcId(firstTc ? firstTc.id : null)
      setStatusMsg('Loaded', 'ok')
      // Mark initial load complete so the auto-save effect doesn't fire on this setDoc.
      initialLoadDoneRef.current = true
    } catch (e) {
      setStatusMsg('Load failed: ' + e.message, 'err')
    }
  }

  const saveToBackend = async () => {
    setStatusMsg('Saving…')
    try {
      const yamlStr = jsyaml.dump(docForExport(doc), { lineWidth: 120, quotingType: '"' })
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/yaml' },
        body: yamlStr,
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || res.statusText)
      }
      const d = await res.json()
      setDirty(false)
      setStatusMsg(`Saved — ${d.summary.casesImported} TCs`, 'ok')
    } catch (e) {
      setStatusMsg('Save failed: ' + e.message, 'err')
    }
  }

  const downloadYaml = () => {
    const text = jsyaml.dump(docForExport(doc), { lineWidth: 120, quotingType: '"' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }))
    a.download = 'test-suite.yaml'
    a.click()
  }

  // Called by the Import dialog once the file has been checked and the user confirms.
  const handleImport = (parsed, fileName) => {
    setDoc(parsed)
    setDirty(true)
    setSelectedFeatIdx(null)
    setSelectedTcId(null)
    setExpandedFeatNames(new Set())
    setImportModalOpen(false)
    setStatusMsg('Imported ' + fileName, 'ok')
  }

  useEffect(() => {
    loadFromBackend()
    loadConfig()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Debounced auto-save: whenever `doc` changes after initial load, schedule a save.
  // Skip while a run is in progress (editor is read-only then, but be defensive).
  useEffect(() => {
    if (!initialLoadDoneRef.current) return
    if (!dirty) return
    if (readOnly) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { saveToBackend() }, 500)
    return () => clearTimeout(saveTimerRef.current)
  }, [doc, dirty, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket listener — tracks whether a test run is in progress so the editor
  // can lock to read-only. Self-contained (does not depend on AppContext).
  useEffect(() => {
    let ws = null
    let reconnectTimer = null
    let closed = false

    const connect = async () => {
      const url = await buildAuthedWsUrl('/ws')
      if (closed) return // AuthGate/unmount may have raced the await
      ws = new WebSocket(url)

      ws.onmessage = (evt) => {
        let msg
        try { msg = JSON.parse(evt.data) } catch { return }
        switch (msg.type) {
          case 'test_start':
            if (msg.sessionId) {
              setActiveFeatures(prev => {
                if (prev.has(msg.sessionId)) return prev
                const next = new Set(prev)
                next.add(msg.sessionId)
                return next
              })
            }
            break
          case 'feature_complete':
            if (msg.feature) {
              setActiveFeatures(prev => {
                if (!prev.has(msg.feature)) return prev
                const next = new Set(prev)
                next.delete(msg.feature)
                return next
              })
            }
            break
          case 'run_complete':
            setActiveFeatures(new Set())
            setAnyRunningFromSnapshot(false)
            break
          case 'test_results_snapshot':
            if (msg.results) {
              const any = Object.values(msg.results).some(r => r?.status === 'RUNNING')
              setAnyRunningFromSnapshot(any)
            }
            break
        }
      }

      ws.onclose = () => {
        if (closed) return
        reconnectTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => {}
    }

    connect()
    return () => {
      closed = true
      clearTimeout(reconnectTimer)
      try { ws?.close() } catch { /* ignore */ }
    }
  }, [])

  const selectedFeat = selectedFeatIdx != null ? doc.features[selectedFeatIdx] : null
  const selectedTc = selectedFeat ? (selectedFeat.testCases || []).find(t => t.id === selectedTcId) : null

  const handleFeatureClick = (featName) => {
    const idx = doc.features.findIndex(m => m.name === featName)
    if (idx === -1) return
    // Only open / close the group. The right-hand panel keeps showing whatever
    // is being edited; picking a test case (or Edit / +) is what changes it.
    setExpandedFeatNames(prev => {
      const next = new Set(prev)
      next.has(featName) ? next.delete(featName) : next.add(featName)
      return next
    })
  }

  const handleTcClick = (tcId, featName) => {
    const idx = doc.features.findIndex(m => m.name === featName)
    if (idx !== -1) {
      setSelectedFeatIdx(idx)
      setExpandedFeatNames(p => new Set(p).add(featName))
    }
    setSelectedTcId(prev => (prev === tcId && selectedFeatIdx === idx) ? null : tcId)
  }

  // Confirmation happens inside the Edit Feature modal, so this deletes straight away.
  const handleDeleteFeat = (featName) => {
    const idx = doc.features.findIndex(m => m.name === featName)
    if (idx === -1) return
    setDoc(prev => {
      const feats = [...prev.features]
      feats.splice(idx, 1)
      return { ...prev, features: feats }
    })
    if (selectedFeatIdx === idx) { setSelectedFeatIdx(null); setSelectedTcId(null) }
    else if (selectedFeatIdx > idx) setSelectedFeatIdx(prev => prev - 1)
    setExpandedFeatNames(prev => { const next = new Set(prev); next.delete(featName); return next })
    setDirty(true)
    setStatusMsg('Feature deleted: ' + featName, 'ok')
  }

  const handleOpenAddFeat = () => {
    setEditingFeatIdx(null)
    setFeatModalOpen(true)
  }

  const handleOpenEditFeat = (idx) => {
    setEditingFeatIdx(idx)
    setFeatModalOpen(true)
  }

  const handleConfirmFeat = ({ name, description, testCases }) => {
    if (editingFeatIdx != null) {
      setDoc(prev => {
        const feats = [...prev.features]
        const oldName = feats[editingFeatIdx].name
        feats[editingFeatIdx] = { ...feats[editingFeatIdx], name, description: description || undefined }
        if (oldName !== name) {
          setExpandedFeatNames(p => {
            if (!p.has(oldName)) return p
            const next = new Set(p); next.delete(oldName); next.add(name); return next
          })
        }
        return { ...prev, features: feats }
      })
      setStatusMsg('Feature updated', 'ok')
    } else {
      if (doc.features.find(m => m.name === name)) { setStatusMsg('Feature already exists', 'err'); return }
      // Test cases drafted from a spec arrive without ids; number them after the highest existing one.
      let max = 0
      for (const f of doc.features) for (const t of f.testCases || []) {
        const m = /^TC(\d+)$/.exec(t.id || ''); if (m) max = Math.max(max, parseInt(m[1], 10))
      }
      const newCases = (testCases || []).map(tc => ({ ...tc, id: `TC${String(++max).padStart(3, '0')}` }))
      setDoc(prev => {
        const feats = [...prev.features, { name, description, testCases: newCases }]
        setSelectedFeatIdx(feats.length - 1)
        setExpandedFeatNames(p => new Set(p).add(name))
        setSelectedTcId(newCases[0]?.id ?? null)
        return { ...prev, features: feats }
      })
      setStatusMsg(newCases.length ? `Added feature "${name}" with ${newCases.length} test case${newCases.length === 1 ? '' : 's'}` : 'Feature added: ' + name, 'ok')
    }
    setDirty(true)
    setFeatModalOpen(false)
  }

  // "+" on a feature opens the Edit-with-AI modal in create mode; nothing is added
  // until the user confirms the draft (handleAddTc below).
  const handleStartAddTc = (featIdx) => setAddingToFeatIdx(featIdx)

  const handleAddTc = (featIdx, draft) => {
    setDoc(prev => {
      const feats = [...prev.features]
      const feat = { ...feats[featIdx] }
      if (!feat.testCases) feat.testCases = []
      const newTc = {
        id: nextTcId(prev.features),
        title: draft.title,
        given: draft.given,
        when: draft.when,
        then: draft.then,
      }
      feat.testCases = [...feat.testCases, newTc]
      feats[featIdx] = feat
      setSelectedFeatIdx(featIdx)
      setSelectedTcId(newTc.id)
      setExpandedFeatNames(p => new Set(p).add(feat.name))   // show the new case even if the feature was collapsed
      return { ...prev, features: feats }
    })
    setDirty(true)
  }

  const handleApplyTc = (updated) => {
    setDoc(prev => {
      const feats = prev.features.map((m, i) => {
        if (i !== selectedFeatIdx) return m
        return {
          ...m,
          testCases: (m.testCases || []).map(t => t.id === updated.id ? updated : t),
        }
      })
      return { ...prev, features: feats }
    })
    setDirty(true)
    setStatusMsg('Changes applied', 'ok')
  }

  const handleDeleteTc = () => {
    if (!selectedTcId) return
    if (!confirm(`Delete ${selectedTcId}?`)) return
    setDoc(prev => {
      const feats = prev.features.map((m, i) => {
        if (i !== selectedFeatIdx) return m
        return { ...m, testCases: (m.testCases || []).filter(t => t.id !== selectedTcId) }
      })
      return { ...prev, features: feats }
    })
    setSelectedTcId(null)
    setDirty(true)
  }

  // Build feature data for panel
  const featuresForPanel = doc.features.map(m => m.name)
  const testCasesForPanel = {}
  doc.features.forEach(m => { testCasesForPanel[m.name] = m.testCases || [] })


  // Nav right content
  const navRight = (
    <>
      {status.msg && (
        <span style={{
          fontSize: 12,
          marginRight: 4,
          color: status.kind === 'ok' ? 'var(--green)' : status.kind === 'err' ? 'var(--red)' : 'var(--text-muted)'
        }}>
          {status.msg}
        </span>
      )}
    </>
  )

  // Left panel toolbar — primary creation actions on the left,
  // file operations grouped on the right
  const leftToolbar = (
    <>
      <Btn variant="primary" onClick={handleOpenAddFeat} disabled={readOnly}>
        <Icon name="add" />Add Feature
      </Btn>

      <span className={styles.toolbarDivider} />

      <Btn onClick={() => setImportModalOpen(true)} disabled={readOnly} title="Import a test suite from a YAML file (template available)">
        <Icon name="upload_file" />Import
      </Btn>
      <Btn onClick={downloadYaml} title="Download current test suite as YAML">
        <Icon name="download" />Export
      </Btn>
      <Btn onClick={loadFromBackend} title="Reload from backend, discarding any unsaved changes">
        <Icon name="refresh" />Reload
      </Btn>
    </>
  )

  // Right panel content
  const renderRight = () => {
    if (selectedTc) {
      return (
        <>
          <TcEditor
            tc={selectedTc}
            onApply={handleApplyTc}
            onDelete={handleDeleteTc}
            readOnly={readOnly}
          />
        </>
      )
    }

    return (
      <div className={styles.emptyState}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.25">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <div style={{ fontSize: 14 }}>Select a test case to edit</div>
        <div style={{ fontSize: 12 }}>Use <strong>+</strong> on a feature to add one, or <strong>+ Add Feature</strong> to start a new group (it can draft test cases from a spec)</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <NavBar rightContent={navRight} />

      {readOnly && (
        <div className={styles.readOnlyBanner}>
          <Icon name="lock" />
          <span>
            <strong>Editor is read-only</strong> — a test run is in progress.
            Editing will be enabled when the run completes or is reset.
          </span>
        </div>
      )}

      {/* Target URL bar — the app under test */}
      <div className={styles.targetBar}>
        <Icon name="public" />
        <span className={styles.targetLabel}>Target URL</span>
        <input
          type="url"
          className={styles.targetInput}
          value={targetUrl}
          onChange={(e) => { setTargetUrl(e.target.value); setTargetUrlDirty(true) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && targetUrlDirty) saveTargetUrl() }}
          placeholder="https://your-app-under-test.example.com"
          disabled={readOnly}
        />
        <Btn
          size="sm"
          variant={targetUrlDirty ? 'primary' : ''}
          disabled={!targetUrlDirty || readOnly}
          onClick={saveTargetUrl}
        >
          <Icon name="save" />{targetUrlDirty ? 'Save URL' : 'Saved'}
        </Btn>
        <Btn
          size="sm"
          onClick={() => setAuthModalOpen(true)}
          title={authSummary.enabled
            ? `Authentication is on (${authSummary.count} account${authSummary.count === 1 ? '' : 's'}) — click to edit`
            : 'Set the admin / user logins the agent should use'}
        >
          <Icon name="lock" />Authentication
          {authSummary.enabled && authSummary.count > 0 && <span className={styles.authBadge}>{authSummary.count}</span>}
        </Btn>
        <span className={styles.targetHint}>
          The application your test cases will run against
        </span>
      </div>

      <div className={styles.main}>
        <FeaturePanel
          features={featuresForPanel}
          testCases={testCasesForPanel}
          expandedFeatures={expandedFeatNames}
          selectedTcId={selectedTcId}
          onFeatureClick={handleFeatureClick}
          onTcClick={handleTcClick}
          onFeatureEdit={readOnly ? null : (featName) => {
            const idx = doc.features.findIndex(m => m.name === featName)
            if (idx !== -1) handleOpenEditFeat(idx)
          }}
          onTcAdd={readOnly ? null : (featName) => {
            const idx = doc.features.findIndex(m => m.name === featName)
            if (idx !== -1) handleStartAddTc(idx)
          }}
          onExpandAll={() => setExpandedFeatNames(new Set(doc.features.map(m => m.name)))}
          onCollapseAll={() => setExpandedFeatNames(new Set())}
          showExpandControls={true}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          toolbar={leftToolbar}
        />

        {/* Right panel */}
        <div className={styles.rightPanel}>
          {renderRight()}
        </div>
      </div>

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImport}
        existingCount={doc.features.length}
      />
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        readOnly={readOnly}
        onSaved={(a) => { setAuthSummary(summarizeAuth(a)); setStatusMsg(a.enabled ? 'Authentication saved' : 'Authentication disabled', 'ok') }}
      />
      <EditWithAiModal
        open={addingToFeatIdx != null}
        mode="create"
        onClose={() => setAddingToFeatIdx(null)}
        feature={addingToFeatIdx != null ? {
          name: doc.features[addingToFeatIdx]?.name,
          background: doc.features[addingToFeatIdx]?.description,
          existingTitles: (doc.features[addingToFeatIdx]?.testCases || []).map(t => t.title),
        } : null}
        api={api}
        onSave={(draft) => {
          const idx = addingToFeatIdx
          setAddingToFeatIdx(null)
          if (idx != null) handleAddTc(idx, draft)
        }}
      />
      <FeatureModal
        open={featModalOpen}
        onClose={() => setFeatModalOpen(false)}
        onConfirm={handleConfirmFeat}
        onDelete={() => {
          const name = doc.features[editingFeatIdx]?.name
          setFeatModalOpen(false)
          if (name) handleDeleteFeat(name)
        }}
        editFeature={editingFeatIdx != null ? doc.features[editingFeatIdx] : null}
        existingNames={doc.features.filter((_, i) => i !== editingFeatIdx).map(f => f.name)}
      />

    </div>
  )
}
