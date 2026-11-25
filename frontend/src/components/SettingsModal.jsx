import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import styles from './SettingsModal.module.css'
import EnvVarsEditor, { validateEnvVars, cleanEnvVars } from './EnvVarsEditor'
import DatabasesEditor, { validateDatabases, cleanDatabases, toRows } from './DatabasesEditor'
import { ModelRegionPicker, MODEL_IDS, KNOWN_REGIONS_FALLBACK, toChoice, fromChoice } from './ModelRegionPicker'

/**
 * Two sections:
 *   Orchestration platform — theme, and the Bedrock model + region the platform
 *     itself uses for Edit with AI, drafting test cases from a spec and checks.
 *   Testing AI agent — which runtime drives the browser (AgentCore or local), and
 *     the Bedrock model + region the agent thinks with while it runs tests.
 */
export default function SettingsModal({ open, onClose, currentModel, currentMode, api, onSave, theme, onToggleTheme }) {
  const [knownRegions, setKnownRegions] = useState(KNOWN_REGIONS_FALLBACK)
  // platform
  const [pModel, setPModel] = useState({ choice: '', custom: '' })
  const [pRegion, setPRegion] = useState({ choice: '', custom: '' })
  // agent
  const [mode, setMode] = useState(currentMode || 'local')
  const [aModel, setAModel] = useState({ choice: '', custom: '' })
  const [aRegion, setARegion] = useState({ choice: '', custom: '' })
  const [browserRegion, setBrowserRegion] = useState('')
  const [saved, setSaved] = useState({ pModel: '', pRegion: '', aModel: '', aRegion: '' })
  const [envRows, setEnvRows] = useState([])
  const [envLimits, setEnvLimits] = useState({ value: 2000, description: 500 })
  const [envReserved, setEnvReserved] = useState(['TARGET_URL'])
  const [envSaved, setEnvSaved] = useState('[]')
  const [dbRows, setDbRows] = useState([])
  const [dbLimits, setDbLimits] = useState({ description: 4000 })
  const [dbSaved, setDbSaved] = useState('[]')
  const [builtIn, setBuiltIn] = useState([])
  const [status, setStatus] = useState({ kind: 'loading' })      // loading | idle | saving | error

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus({ kind: 'loading' })
    setMode(currentMode || 'local')
    Promise.all([
      api.getConfig(),
      api.getKnownRegions?.().catch(() => null),
      api.getEnvVars().catch(() => null),
      api.getAuth().catch(() => null),
      api.getDatabases().catch(() => null),
    ]).then(([cfg, regions, env, auth, dbs]) => {
      if (cancelled) return
      const known = regions?.regions?.length ? regions.regions : KNOWN_REGIONS_FALLBACK
      setKnownRegions(known)
      setPModel(toChoice(cfg.model || currentModel, MODEL_IDS))
      setPRegion(toChoice(cfg.bedrockRegion, known))
      setAModel(toChoice(cfg.agentModel, MODEL_IDS))
      setARegion(toChoice(cfg.agentRegion, known))
      setBrowserRegion(cfg.browserRegion || '')
      const rows = (env?.variables || []).map(v => ({ name: v.name, value: v.value, description: v.description, secret: !!v.secret }))
      setEnvRows(rows); setEnvSaved(JSON.stringify(cleanEnvVars(rows)))
      if (env?.limits) setEnvLimits(env.limits)
      if (env?.reserved) setEnvReserved(env.reserved)
      const dRows = toRows(dbs?.connections)
      setDbRows(dRows); setDbSaved(JSON.stringify(cleanDatabases(dRows)))
      if (dbs?.limits) setDbLimits(dbs.limits)
      const accts = (auth?.accounts || []).filter(a => a.username)
      setBuiltIn([
        { name: 'TARGET_URL', value: cfg.targetUrl, where: 'Test Editor → Target URL', description: 'The application under test; the agent always starts here.' },
        { name: 'LOGINS', value: auth?.enabled ? (accts.length ? accts.map(a => `${a.role === 'admin' ? 'Admin' : 'Regular user'}: ${a.username}`).join(' · ') : 'on, but no username set') : 'off — no login given to the agent', where: 'Test Editor → Authentication', description: 'Admin and Regular user sign-ins.' },
      ])
      setSaved({ pModel: cfg.model || '', pRegion: cfg.bedrockRegion || '', aModel: cfg.agentModel || '', aRegion: cfg.agentRegion || '' })
      setStatus({ kind: 'idle' })
    }).catch(e => !cancelled && setStatus({ kind: 'error', error: `Couldn't load settings: ${e.message}` }))
    return () => { cancelled = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const ids = { pModel: fromChoice(pModel), pRegion: fromChoice(pRegion), aModel: fromChoice(aModel), aRegion: fromChoice(aRegion) }
  const missing = !ids.pModel || !ids.pRegion || !ids.aModel || !ids.aRegion
  const busy = status.kind === 'loading' || status.kind === 'saving'
  const envErrors = validateEnvVars(envRows, envReserved, envLimits)
  const envInvalid = Object.keys(envErrors).length > 0
  const envDirty = JSON.stringify(cleanEnvVars(envRows)) !== envSaved

  const dbErrors = validateDatabases(dbRows, dbLimits)
  const dbInvalid = Object.keys(dbErrors).length > 0
  const dbDirty = JSON.stringify(cleanDatabases(dbRows)) !== dbSaved

  const handleSave = async () => {
    if (missing || envInvalid || dbInvalid) return
    setStatus({ kind: 'saving' })
    try {
      // Only send what changed, so an unrelated save never rewrites a value.
      if (ids.pRegion !== saved.pRegion) await api.updateRegions({ bedrockRegion: ids.pRegion })
      if (ids.aModel !== saved.aModel || ids.aRegion !== saved.aRegion) {
        await api.updateAgent({ model: ids.aModel, region: ids.aRegion })
      }
      if (envDirty) await api.saveEnvVars(cleanEnvVars(envRows))
      if (dbDirty) await api.saveDatabases(cleanDatabases(dbRows))
      let savedMode = currentMode
      if (mode !== currentMode) { await api.updateMode(mode); savedMode = mode }
      await onSave({ model: ids.pModel, mode: savedMode })
      onClose()
    } catch (e) {
      setStatus({ kind: 'error', error: `Save failed: ${e.message}` })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      width="min(820px, 94vw)"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={busy || missing || envInvalid || dbInvalid} onClick={handleSave}>Save</Btn>
        </>
      }
    >
      {/* ───────── Orchestration platform ───────── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}><Icon name="tune" size={16} />Orchestration platform</h3>
        <div className={styles.sectionSub}>The app you are using now. Its own AI features — <strong>Edit with AI</strong> and <strong>drafting test cases from a spec</strong> — use the model below.</div>

        <div className={styles.field}>
          <label className={styles.label}>Appearance</label>
          <button type="button" className={styles.themeBtn} onClick={onToggleTheme}>
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
            <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'} mode</span>
          </button>
        </div>

        <ModelRegionPicker
          idPrefix="platform"
          model={pModel} region={pRegion} knownRegions={knownRegions} api={api}
          current={saved.pModel}
          onChange={(p) => { if (p.model) setPModel(p.model); if (p.region) setPRegion(p.region) }}
        />
      </section>

      {/* ───────── Testing AI agent ───────── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}><Icon name="smart_toy" size={16} />Testing AI agent</h3>
        <div className={styles.sectionSub}>The agent that opens a browser and runs your test cases. Applies from the next test run.</div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-mode">Mode</label>
          <select id="agent-mode" className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="agentcore">AgentCore Runtime (managed browser in AWS)</option>
            <option value="local">Local Runtime (Chromium on this machine)</option>
          </select>
          <div className={styles.hint}>Switching modes closes any open browser sessions.</div>
        </div>

        <ModelRegionPicker
          idPrefix="agent"
          model={aModel} region={aRegion} knownRegions={knownRegions} api={api}
          current={saved.aModel}
          onChange={(p) => { if (p.model) setAModel(p.model); if (p.region) setARegion(p.region) }}
          regionNote="Where the agent's model calls go. This is separate from where the AgentCore Runtime and its browser run."
        />

        <div className={styles.field}>
          <label className={styles.label}>Context variables</label>
          <div className={styles.hint} style={{ marginTop: 0 }}>
            Named values handed to the agent on every run. Add a description saying <strong>when</strong> to use each one, so the agent knows whether it applies to a test.
          </div>
          <EnvVarsEditor rows={envRows} onChange={setEnvRows} builtIn={builtIn} errors={envErrors} disabled={busy} />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Database connections</label>
          <div className={styles.hint} style={{ marginTop: 0 }}>
            <strong>The database user must be read-only</strong> (only SELECT rights), on test or staging data, never production. The tools add their own checks (SELECT only, a read-only transaction, 200 rows and 15 s per query), but those are a safety net, not the permission boundary. Lets the agent check stored data during a run, for example that a transfer wrote its ledger rows. The password is stored in the backend config and sent to the runtime with each run; it is never shown again. In AgentCore mode the database must be reachable from the runtime's network.
          </div>
          <DatabasesEditor rows={dbRows} onChange={setDbRows} errors={dbErrors} disabled={busy} api={api} />
        </div>

        {mode === 'agentcore' && (
          <div className={styles.field}>
            <label className={styles.label}>AgentCore Runtime &amp; Browser region</label>
            <div className={styles.readonly}>{browserRegion || '—'}</div>
            <div className={styles.hint}>Set when the runtime is deployed (<code>./init-agentcore-runtime.sh</code>); not changeable here.</div>
          </div>
        )}
      </section>

      {status.kind === 'error' && <div className={styles.error} role="alert">{status.error}</div>}
    </Modal>
  )
}
