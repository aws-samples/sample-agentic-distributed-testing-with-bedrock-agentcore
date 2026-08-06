import { useState, useEffect, useRef } from 'react'
import jsyaml from 'js-yaml'
import NavBar from '../components/NavBar'
import ModulePanel from '../components/ModulePanel'
import ModuleModal from '../components/ModuleModal'
import TcEditor from '../components/TcEditor'
import GenerateModal from '../components/GenerateModal'
import Btn from '../components/Btn'
import Icon from '../components/Icon'
import { buildAuthedWsUrl } from '../context/authFetch'
import styles from './EditorPage.module.css'

function modId(i) { return 'MD' + String(i + 1).padStart(3, '0') }

function nextTcId(mod, allModules) {
  const mi = allModules.findIndex(m => m.name === mod.name)
  const prefix = modId(mi)
  const nums = (mod.testCases || []).map(t => {
    const m = t.id?.match(/TC(\d+)$/)
    return m ? parseInt(m[1], 10) : 0
  })
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `${prefix}-TC${String(next).padStart(3, '0')}`
}

function docForExport(doc) {
  return {
    ...doc,
    modules: doc.modules.map(m => ({
      name: m.name,
      testCases: (m.testCases || []).map(tc => ({
        id: tc.id, title: tc.title,
        preconditions: tc.preconditions, steps: tc.steps, expectedResult: tc.expectedResult,
      })),
    })),
  }
}

export default function EditorPage() {
  const [doc, setDoc] = useState({ modules: [] })
  const [selectedModIdx, setSelectedModIdx] = useState(null)
  const [selectedTcId, setSelectedTcId] = useState(null)
  const [expandedModNames, setExpandedModNames] = useState(new Set()) // tree expansion (independent of editing selection)
  const [searchQuery, setSearchQuery] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState({ msg: '', kind: '' })
  const [modModalOpen, setModModalOpen] = useState(false)
  const [editingModIdx, setEditingModIdx] = useState(null)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [targetUrl, setTargetUrl] = useState('')
  const [targetUrlDirty, setTargetUrlDirty] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPasswordSet, setAuthPasswordSet] = useState(false) // backend has a stored password
  const [authDirty, setAuthDirty] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Read-only mode while a test run is in progress
  const [activeModules, setActiveModules] = useState(new Set())
  const [anyRunningFromSnapshot, setAnyRunningFromSnapshot] = useState(false)
  const readOnly = activeModules.size > 0 || anyRunningFromSnapshot
  const initialLoadDoneRef = useRef(false)
  const saveTimerRef = useRef(null)
  let statusTimer = null

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const cfg = await res.json()
      setTargetUrl(cfg.targetUrl || '')
      setTargetUrlDirty(false)
      const a = cfg.auth || {}
      setAuthEnabled(!!a.enabled)
      setAuthUsername(a.username || '')
      setAuthPasswordSet(!!a.passwordSet)
      setAuthPassword('') // never echo from server; field starts empty
      setAuthDirty(false)
    } catch { /* ignore */ }
  }

  const saveAuth = async () => {
    try {
      const body = { enabled: authEnabled, username: authUsername }
      // Only send password if user typed one (don't clobber the stored one with empty)
      if (authPassword !== '') body.password = authPassword
      const res = await fetch('/api/config/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setAuthPasswordSet(!!data.auth?.passwordSet)
      setAuthPassword('')
      setAuthDirty(false)
      setStatusMsg(authEnabled ? 'Authentication saved' : 'Authentication disabled', 'ok')
    } catch (e) {
      setStatusMsg('Save failed: ' + e.message, 'err')
    }
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
      const parsed = jsyaml.load(text) || { modules: [] }
      const loaded = parsed
      if (!loaded.modules) loaded.modules = []
      setDoc(loaded)
      setDirty(false)
      // Pre-select the first module and its first test case (if any exist)
      // so reloading the page doesn't land on an empty right panel.
      const firstMod = loaded.modules[0]
      const firstTc = firstMod?.testCases?.[0]
      setSelectedModIdx(firstMod ? 0 : null)
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

  // Called when generation completes — ask user to export first if there's existing data
  const handleGenerated = (generatedDoc) => {
    const hasExisting = doc.modules.length > 0
    if (hasExisting) {
      const confirmed = window.confirm(
        `This will replace your current ${doc.modules.length} module(s) and all their test cases.\n\n` +
        `Click OK to replace, or Cancel to keep your current test suite.\n\n` +
        `Tip: Export your current suite first (Export button) to save a backup.`
      )
      if (!confirmed) return
    }
    setDoc(generatedDoc)
    setDirty(true)
    setSelectedModIdx(null)
    setSelectedTcId(null)
    setExpandedModNames(new Set())
    setStatusMsg(`Generated ${generatedDoc.modules.length} modules with ${generatedDoc.modules.reduce((s, m) => s + (m.testCases?.length || 0), 0)} test cases`, 'ok')
  }

  const importYamlFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = jsyaml.load(ev.target.result) || { modules: [] }
        if (!parsed.modules) throw new Error('Expected { modules: [...] }')
        setDoc(parsed)
        setDirty(true)
        setSelectedModIdx(null)
        setSelectedTcId(null)
        setStatusMsg('Imported ' + file.name, 'ok')
      } catch (err) {
        setStatusMsg('YAML parse error: ' + err.message, 'err')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
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
              setActiveModules(prev => {
                if (prev.has(msg.sessionId)) return prev
                const next = new Set(prev)
                next.add(msg.sessionId)
                return next
              })
            }
            break
          case 'module_complete':
            if (msg.module) {
              setActiveModules(prev => {
                if (!prev.has(msg.module)) return prev
                const next = new Set(prev)
                next.delete(msg.module)
                return next
              })
            }
            break
          case 'run_complete':
            setActiveModules(new Set())
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

  const selectedMod = selectedModIdx != null ? doc.modules[selectedModIdx] : null
  const selectedTc = selectedMod ? (selectedMod.testCases || []).find(t => t.id === selectedTcId) : null

  const handleModuleClick = (modName) => {
    const idx = doc.modules.findIndex(m => m.name === modName)
    if (idx === -1) return
    // Toggle tree expansion
    setExpandedModNames(prev => {
      const next = new Set(prev)
      next.has(modName) ? next.delete(modName) : next.add(modName)
      return next
    })
    // Select for editing
    setSelectedModIdx(idx === selectedModIdx ? null : idx)
    setSelectedTcId(null)
  }

  const handleTcClick = (tcId, modName) => {
    const idx = doc.modules.findIndex(m => m.name === modName)
    if (idx !== -1) setSelectedModIdx(idx)
    setSelectedTcId(prev => (prev === tcId && selectedModIdx === idx) ? null : tcId)
  }

  const handleDeleteMod = (modName) => {
    const idx = doc.modules.findIndex(m => m.name === modName)
    if (idx === -1) return
    const mod = doc.modules[idx]
    if (!confirm(`Delete module "${mod.name}" and all ${(mod.testCases || []).length} test cases?`)) return
    setDoc(prev => {
      const mods = [...prev.modules]
      mods.splice(idx, 1)
      return { ...prev, modules: mods }
    })
    if (selectedModIdx === idx) { setSelectedModIdx(null); setSelectedTcId(null) }
    else if (selectedModIdx > idx) setSelectedModIdx(prev => prev - 1)
    setDirty(true)
  }

  const handleOpenAddMod = () => {
    setEditingModIdx(null)
    setModModalOpen(true)
  }

  const handleOpenEditMod = (idx) => {
    setEditingModIdx(idx)
    setModModalOpen(true)
  }

  const handleConfirmMod = ({ name, description }) => {
    if (editingModIdx != null) {
      setDoc(prev => {
        const mods = [...prev.modules]
        mods[editingModIdx] = { ...mods[editingModIdx], name, description: description || undefined }
        return { ...prev, modules: mods }
      })
      setStatusMsg('Module updated', 'ok')
    } else {
      if (doc.modules.find(m => m.name === name)) { setStatusMsg('Module already exists', 'err'); return }
      setDoc(prev => {
        const mods = [...prev.modules, { name, description, testCases: [] }]
        setSelectedModIdx(mods.length - 1)
        setSelectedTcId(null)
        return { ...prev, modules: mods }
      })
      setStatusMsg('Module added: ' + name, 'ok')
    }
    setDirty(true)
    setModModalOpen(false)
  }

  const handleAddTc = (modIdx) => {
    setDoc(prev => {
      const mods = [...prev.modules]
      const mod = { ...mods[modIdx] }
      if (!mod.testCases) mod.testCases = []
      const newTc = {
        id: nextTcId(mod, prev.modules),
        title: 'New test case',
        preconditions: ['None'],
        steps: ['Step 1'],
        expectedResult: ['Expected result'],
      }
      mod.testCases = [...mod.testCases, newTc]
      mods[modIdx] = mod
      setSelectedModIdx(modIdx)
      setSelectedTcId(newTc.id)
      return { ...prev, modules: mods }
    })
    setDirty(true)
  }

  const handleApplyTc = (updated) => {
    setDoc(prev => {
      const mods = prev.modules.map((m, i) => {
        if (i !== selectedModIdx) return m
        return {
          ...m,
          testCases: (m.testCases || []).map(t => t.id === updated.id ? updated : t),
        }
      })
      return { ...prev, modules: mods }
    })
    setDirty(true)
    setStatusMsg('Changes applied', 'ok')
  }

  const handleDeleteTc = () => {
    if (!selectedTcId) return
    if (!confirm(`Delete ${selectedTcId}?`)) return
    setDoc(prev => {
      const mods = prev.modules.map((m, i) => {
        if (i !== selectedModIdx) return m
        return { ...m, testCases: (m.testCases || []).filter(t => t.id !== selectedTcId) }
      })
      return { ...prev, modules: mods }
    })
    setSelectedTcId(null)
    setDirty(true)
  }

  // Build module data for panel
  const modulesForPanel = doc.modules.map(m => m.name)
  const testCasesForPanel = {}
  doc.modules.forEach(m => { testCasesForPanel[m.name] = m.testCases || [] })

  const expandedModule = selectedModIdx != null ? doc.modules[selectedModIdx]?.name : null
  // Keep expandedModNames in sync when selected module changes
  // (selecting a module auto-expands it)
  if (expandedModule && !expandedModNames.has(expandedModule)) {
    expandedModNames.add(expandedModule)
  }

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
      <Btn variant="primary" onClick={handleOpenAddMod} disabled={readOnly}>
        <Icon name="add" />Add Module
      </Btn>
      <Btn onClick={() => setGenerateModalOpen(true)} disabled={readOnly}>
        <Icon name="auto_awesome" />Generate from Spec
      </Btn>

      <span className={styles.toolbarDivider} />

      <Btn onClick={() => document.getElementById('importFileInput').click()} disabled={readOnly} title="Import test suite from YAML file">
        <Icon name="upload_file" />Import
      </Btn>
      <Btn onClick={downloadYaml} title="Download current test suite as YAML">
        <Icon name="download" />Export
      </Btn>
      <Btn onClick={loadFromBackend} title="Reload from backend, discarding any unsaved changes">
        <Icon name="refresh" />Reload
      </Btn>
      <input
        type="file"
        id="importFileInput"
        accept=".yaml,.yml"
        style={{ display: 'none' }}
        onChange={importYamlFile}
      />
    </>
  )

  // Right panel content
  const renderRight = () => {
    if (selectedTc) {
      return (
        <>
          <div className={styles.rightHeader}>
            <span className={styles.rightHeaderId}>{selectedMod ? modId(selectedModIdx) : ''}</span>
            <span className={styles.rightHeaderTitle}>{selectedMod?.name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>›</span>
            <span className={styles.rightHeaderId} style={{ color: 'var(--accent)' }}>{selectedTc.id}</span>
            <span className={styles.rightHeaderSub}>{selectedTc.title}</span>
          </div>
          <TcEditor
            tc={selectedTc}
            onApply={handleApplyTc}
            onDelete={handleDeleteTc}
            readOnly={readOnly}
          />
        </>
      )
    }

    if (selectedMod) {
      const tcs = selectedMod.testCases || []
      return (
        <>
          <div className={styles.rightHeader}>
            <span className={styles.rightHeaderId}>{modId(selectedModIdx)}</span>
            <span className={styles.rightHeaderTitle}>{selectedMod.name}</span>
            {selectedMod.description && (
              <span className={styles.rightHeaderSub}>— {selectedMod.description}</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {tcs.length} test case{tcs.length !== 1 ? 's' : ''}
            </span>
            <Btn size="sm" onClick={() => handleOpenEditMod(selectedModIdx)} disabled={readOnly}><Icon name="edit" />Edit Module</Btn>
          </div>
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
            Select a test case from the left panel to edit it, or click{' '}
            <strong>Add Test Case</strong>.
            <br /><br />
            <Btn variant="primary" onClick={() => handleAddTc(selectedModIdx)} disabled={readOnly}><Icon name="add" />Add Test Case</Btn>
          </div>
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
        <div style={{ fontSize: 14 }}>Select a module or test case to edit</div>
        <div style={{ fontSize: 12 }}>Or click <strong>+ Add Module</strong> to create one</div>
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
        <span className={styles.targetHint}>
          The application your test cases will run against
        </span>
      </div>

      {/* Authentication bar — credentials injected into every test's system prompt */}
      <div className={styles.authBar}>
        <label className={styles.authToggle}>
          <input
            type="checkbox"
            checked={authEnabled}
            onChange={(e) => { setAuthEnabled(e.target.checked); setAuthDirty(true) }}
            disabled={readOnly}
          />
          <Icon name="lock" />
          <span>Need authentication</span>
        </label>

        {authEnabled && (
          <>
            <input
              type="text"
              className={styles.authInput}
              placeholder="Username"
              value={authUsername}
              onChange={(e) => { setAuthUsername(e.target.value); setAuthDirty(true) }}
              autoComplete="off"
              disabled={readOnly}
            />
            <div className={styles.authPasswordWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                className={styles.authInput}
                placeholder={authPasswordSet ? '••••••• (stored)' : 'Password'}
                value={authPassword}
                onChange={(e) => { setAuthPassword(e.target.value); setAuthDirty(true) }}
                autoComplete="new-password"
                disabled={readOnly}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword(s => !s)}
                title={showPassword ? 'Hide' : 'Show'}
                disabled={readOnly}
              >
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
              </button>
            </div>
          </>
        )}

        <Btn
          size="sm"
          variant={authDirty ? 'primary' : ''}
          disabled={!authDirty || readOnly}
          onClick={saveAuth}
        >
          <Icon name="save" />{authDirty ? 'Save Auth' : 'Saved'}
        </Btn>

        <span className={styles.authHint}>
          {authEnabled
            ? 'Agents will log in with these credentials when any test page requires it'
            : 'Enable to give the agent login credentials for the target app'}
        </span>
      </div>

      <div className={styles.main}>
        <ModulePanel
          modules={modulesForPanel}
          testCases={testCasesForPanel}
          expandedModules={expandedModNames}
          selectedTcId={selectedTcId}
          onModuleClick={handleModuleClick}
          onTcClick={handleTcClick}
          onModuleDelete={readOnly ? null : handleDeleteMod}
          onTcAdd={readOnly ? null : (modName) => {
            const idx = doc.modules.findIndex(m => m.name === modName)
            if (idx !== -1) handleAddTc(idx)
          }}
          onExpandAll={() => setExpandedModNames(new Set(doc.modules.map(m => m.name)))}
          onCollapseAll={() => setExpandedModNames(new Set())}
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

      <ModuleModal
        open={modModalOpen}
        onClose={() => setModModalOpen(false)}
        onConfirm={handleConfirmMod}
        editModule={editingModIdx != null ? doc.modules[editingModIdx] : null}
      />

      <GenerateModal
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        onGenerated={handleGenerated}
      />
    </div>
  )
}
