import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'

// Models grouped by provider. Each entry shows the bare Bedrock model id —
// the user pastes/picks it as-is. The list is curated; the "Custom" option
// at the bottom of the dropdown accepts any id for models not listed.
const MODEL_GROUPS = [
  { label: 'Anthropic Claude', models: [
    'global.anthropic.claude-opus-5',
    'global.anthropic.claude-sonnet-5-5',
    'global.anthropic.claude-sonnet-5',
    'global.anthropic.claude-haiku-5-5',
    'global.anthropic.claude-opus-4-8',
    'global.anthropic.claude-opus-4-7',
  ]},
  { label: 'xAI Grok', models: [
    'global.xai.grok-4.7',
  ]},
  { label: 'OpenAI GPT-OSS', models: [
    'openai.gpt-oss-120b-1:0',
    'openai.gpt-oss-safeguard-120b',
  ]},
  { label: 'Moonshot Kimi', models: [
    'global.moonshotai.kimi-k3',
    'moonshot.kimi-k2-thinking',
    'moonshotai.kimi-k2.5',
  ]},
  { label: 'MiniMax', models: [
    'minimax.minimax-m2.5',
  ]},
  { label: 'Alibaba Qwen', models: [
    'qwen.qwen3-coder-next',
    'qwen.qwen3-next-80b-a3b',
  ]},
  { label: 'Z.ai GLM', models: [
    'global.zai.glm-5.3',
    'zai.glm-5',
  ]},
]
const KNOWN_MODELS = MODEL_GROUPS.flatMap(g => g.models)

export default function SettingsModal({ open, onClose, currentModel, currentMode, api, onSave, theme, onToggleTheme }) {
  const [modelSelect, setModelSelect] = useState('global.anthropic.claude-sonnet-5')
  const [modelCustom, setModelCustom] = useState('')
  const [healthStatus, setHealthStatus] = useState('')
  const [healthColor, setHealthColor] = useState('var(--text-muted)')
  const [healthLoading, setHealthLoading] = useState(false)
  const [bedrockRegion, setBedrockRegion] = useState('us-east-1')
  const [browserRegion, setBrowserRegion] = useState('ap-southeast-1')
  const [bedrockRegionCustom, setBedrockRegionCustom] = useState('')
  const [browserRegionCustom, setBrowserRegionCustom] = useState('')
  const [knownRegions, setKnownRegions] = useState([
    'us-east-1', 'us-east-2', 'us-west-2',
    'eu-west-1', 'eu-central-1', 'eu-north-1',
    'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
  ])
  const [regionDirty, setRegionDirty] = useState(false)
  const [mode, setMode] = useState(currentMode || 'local')

  useEffect(() => {
    if (!open) return
    const cur = currentModel || ''
    if (KNOWN_MODELS.includes(cur)) {
      setModelSelect(cur)
      setModelCustom('')
    } else if (cur) {
      setModelSelect('__custom__')
      setModelCustom(cur)
    } else {
      setModelSelect('global.anthropic.claude-sonnet-5')
    }
    setHealthStatus('')
    setRegionDirty(false)
    setMode(currentMode || 'local')
    // Hydrate region inputs from the backend's live config — these may have
    // been changed in a previous session and persisted in config.json.
    api.getConfig().then(cfg => {
      if (cfg.bedrockRegion) {
        if (knownRegions.includes(cfg.bedrockRegion)) {
          setBedrockRegion(cfg.bedrockRegion); setBedrockRegionCustom('')
        } else {
          setBedrockRegion('__custom__'); setBedrockRegionCustom(cfg.bedrockRegion)
        }
      }
      if (cfg.browserRegion) {
        if (knownRegions.includes(cfg.browserRegion)) {
          setBrowserRegion(cfg.browserRegion); setBrowserRegionCustom('')
        } else {
          setBrowserRegion('__custom__'); setBrowserRegionCustom(cfg.browserRegion)
        }
      }
    }).catch(() => {})
    api.getKnownRegions?.().then(r => {
      if (r?.regions?.length) setKnownRegions(r.regions)
    }).catch(() => {})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveBedrockRegion = bedrockRegion === '__custom__' ? bedrockRegionCustom.trim() : bedrockRegion

  const effectiveModel = modelSelect === '__custom__' ? modelCustom.trim() : modelSelect

  const checkModelHealth = async () => {
    if (!effectiveModel || effectiveModel === '__custom__') {
      setHealthStatus('Select a model first')
      setHealthColor('var(--yellow)')
      return
    }
    setHealthLoading(true)
    setHealthStatus('Checking…')
    setHealthColor('var(--text-muted)')
    try {
      const data = await api.checkModelHealth(effectiveModel)
      if (data.ok) {
        setHealthStatus('✓ OK')
        setHealthColor('var(--green)')
      } else {
        setHealthStatus('✗ ' + (data.error || 'Failed'))
        setHealthColor('var(--red)')
      }
    } catch (e) {
      setHealthStatus('✗ ' + e.message)
      setHealthColor('var(--red)')
    } finally {
      setHealthLoading(false)
    }
  }

  const handleSave = async () => {
    const model = effectiveModel
    if (!model || model === '__custom__') return
    // Persist region changes first (so the next model/mode call uses them)
    if (regionDirty) {
      try {
        await api.updateRegions({
          bedrockRegion: effectiveBedrockRegion,
        })
      } catch (e) {
        console.error('Failed to save regions:', e)
      }
    }
    let savedMode = currentMode
    if (mode !== currentMode) {
      try {
        await api.updateMode(mode)
        savedMode = mode
      } catch (e) {
        console.error('Failed to switch agent mode:', e)
      }
    }
    await onSave({ model, mode: savedMode })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      width="480px"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave}>Save</Btn>
        </>
      }
    >
      {/* Theme */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Appearance</label>
        <button
          onClick={onToggleTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 14px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
            transition: 'border-color 0.15s',
            alignSelf: 'flex-start',
          }}
        >
          <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
          <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode</span>
        </button>
      </div>

      {/* Agent Mode — which runtime drives the browser agents. Switching
          closes any open sessions (handled by PATCH /api/config/mode). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agent Mode</label>
        <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="agentcore">AgentCore Runtime</option>
          <option value="local">Local Runtime</option>
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Switching modes closes any open browser sessions.
        </div>
      </div>

      {/* Model */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Amazon Bedrock Model</label>
        <select
          className="form-input"
          value={modelSelect}
          onChange={(e) => setModelSelect(e.target.value)}
        >
          {MODEL_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.models.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Custom">
            <option value="__custom__">Custom model ID…</option>
          </optgroup>
        </select>
        {modelSelect === '__custom__' && (
          <input
            type="text"
            className="form-input"
            value={modelCustom}
            onChange={(e) => setModelCustom(e.target.value)}
            placeholder="Enter full Bedrock model ID"
            style={{ marginTop: 5 }}
          />
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          Current: <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{currentModel || '—'}</span>
          <Btn size="sm" onClick={checkModelHealth} disabled={healthLoading} style={{ marginLeft: 4 }}>Check</Btn>
          <span style={{ fontSize: 11, color: healthColor }}>{healthStatus}</span>
        </div>
      </div>

      {/* Bedrock region — model inference */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Bedrock Region <span style={{ fontWeight: 400, textTransform: 'none' }}>(model inference)</span>
        </label>
        <select
          className="form-input"
          value={bedrockRegion}
          onChange={(e) => { setBedrockRegion(e.target.value); setRegionDirty(true) }}
        >
          {knownRegions.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="__custom__">Custom region…</option>
        </select>
        {bedrockRegion === '__custom__' && (
          <input
            type="text"
            className="form-input"
            value={bedrockRegionCustom}
            onChange={(e) => { setBedrockRegionCustom(e.target.value); setRegionDirty(true) }}
            placeholder="e.g. us-east-1"
            style={{ marginTop: 5 }}
          />
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Where Bedrock model calls are routed (model health check, Generate-from-Spec, agent inference for local mode).
        </div>
      </div>

      {/* AgentCore region — read-only. The Runtime is deployed to one region
          (see init-agentcore-runtime.sh) and Browser sessions must match it,
          so changing it here would only break a working setup. */}
      {mode === 'agentcore' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          AgentCore Region <span style={{ fontWeight: 400, textTransform: 'none' }}>(Runtime + Browser)</span>
        </label>
        <div style={{ fontSize: 12, padding: '7px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          {browserRegion === '__custom__' ? browserRegionCustom : browserRegion}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Set when the runtime is deployed (<code>./init-agentcore-runtime.sh</code>); not changeable from here.
        </div>
      </div>
      )}
    </Modal>
  )
}
