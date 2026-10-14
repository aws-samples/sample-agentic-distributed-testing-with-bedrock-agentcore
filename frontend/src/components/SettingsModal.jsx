import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import styles from './SettingsModal.module.css'
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
  const [status, setStatus] = useState({ kind: 'loading' })      // loading | idle | saving | error

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus({ kind: 'loading' })
    setMode(currentMode || 'local')
    Promise.all([
      api.getConfig(),
      api.getKnownRegions?.().catch(() => null),
    ]).then(([cfg, regions]) => {
      if (cancelled) return
      const known = regions?.regions?.length ? regions.regions : KNOWN_REGIONS_FALLBACK
      setKnownRegions(known)
      setPModel(toChoice(cfg.model || currentModel, MODEL_IDS))
      setPRegion(toChoice(cfg.bedrockRegion, known))
      setAModel(toChoice(cfg.agentModel, MODEL_IDS))
      setARegion(toChoice(cfg.agentRegion, known))
      setBrowserRegion(cfg.browserRegion || '')
      setSaved({ pModel: cfg.model || '', pRegion: cfg.bedrockRegion || '', aModel: cfg.agentModel || '', aRegion: cfg.agentRegion || '' })
      setStatus({ kind: 'idle' })
    }).catch(e => !cancelled && setStatus({ kind: 'error', error: `Couldn't load settings: ${e.message}` }))
    return () => { cancelled = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const ids = { pModel: fromChoice(pModel), pRegion: fromChoice(pRegion), aModel: fromChoice(aModel), aRegion: fromChoice(aRegion) }
  const missing = !ids.pModel || !ids.pRegion || !ids.aModel || !ids.aRegion
  const busy = status.kind === 'loading' || status.kind === 'saving'

  const handleSave = async () => {
    if (missing) return
    setStatus({ kind: 'saving' })
    try {
      // Only send what changed, so an unrelated save never rewrites a value.
      if (ids.pRegion !== saved.pRegion) await api.updateRegions({ bedrockRegion: ids.pRegion })
      if (ids.aModel !== saved.aModel || ids.aRegion !== saved.aRegion) {
        await api.updateAgent({ model: ids.aModel, region: ids.aRegion })
      }
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
      width="min(560px, 94vw)"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={busy || missing} onClick={handleSave}>Save</Btn>
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
