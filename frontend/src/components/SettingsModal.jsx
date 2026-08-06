import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'

// Models grouped by provider. Each entry shows the bare Bedrock model id —
// the user pastes/picks it as-is. The list is curated; the "Custom" option
// at the bottom of the dropdown accepts any id for models not listed.
const MODEL_GROUPS = [
  { label: 'Anthropic Claude', models: [
    'global.anthropic.claude-opus-4-8',
    'global.anthropic.claude-opus-4-7',
    'global.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  ]},
  { label: 'Amazon Nova', models: [
    'amazon.nova-2-lite-v1:0',
    'amazon.nova-2-lite-v1:0:256k',
    'amazon.nova-pro-v1:0',
    'amazon.nova-pro-v1:0:300k',
    'amazon.nova-2-sonic-v1:0',
  ]},
  { label: 'OpenAI GPT-OSS', models: [
    'openai.gpt-oss-120b-1:0',
    'openai.gpt-oss-20b-1:0',
    'openai.gpt-oss-safeguard-120b',
  ]},
  { label: 'Moonshot Kimi', models: [
    'moonshot.kimi-k2-thinking',
    'moonshotai.kimi-k2.5',
  ]},
  { label: 'MiniMax', models: [
    'minimax.minimax-m2',
    'minimax.minimax-m2.1',
    'minimax.minimax-m2.5',
  ]},
  { label: 'Alibaba Qwen', models: [
    'qwen.qwen3-coder-next',
    'qwen.qwen3-next-80b-a3b',
    'qwen.qwen3-32b-v1:0',
    'qwen.qwen3-vl-235b-a22b',
    'qwen.qwen3-coder-30b-a3b-v1:0',
  ]},
  { label: 'Z.ai GLM', models: [
    'zai.glm-5',
    'zai.glm-4.7',
    'zai.glm-4.7-flash',
  ]},
]
const KNOWN_MODELS = MODEL_GROUPS.flatMap(g => g.models)

export default function SettingsModal({ open, onClose, currentModel, currentMode, api, onSave, theme, onToggleTheme }) {
  const [modelSelect, setModelSelect] = useState('global.anthropic.claude-sonnet-4-6')
  const [modelCustom, setModelCustom] = useState('')
  // Deploy-time switch, not user-settable — hydrated from /api/config below.
  // Agent Mode itself is set via AGENT_MODE in .env (deploy-time, an
  // engineer's call, not a per-session UI choice) — see .env.example and
  // deploy-dev.sh. This only gates whether the AgentCore Region field below
  // is meaningful to show at all.
  const [agentcoreEnabled, setAgentcoreEnabled] = useState(false)
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
      setModelSelect('global.anthropic.claude-sonnet-4-6')
    }
    setHealthStatus('')
    setRegionDirty(false)
    // Hydrate region inputs from the backend's live config — these may have
    // been changed in a previous session and persisted in config.json.
    api.getConfig().then(cfg => {
      setAgentcoreEnabled(!!cfg.agentcoreEnabled)
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
  const effectiveBrowserRegion = browserRegion === '__custom__' ? browserRegionCustom.trim() : browserRegion

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
          browserRegion: effectiveBrowserRegion,
        })
      } catch (e) {
        console.error('Failed to save regions:', e)
      }
    }
    await onSave({ model })
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

      {/* Agent Mode — read-only. Set via AGENT_MODE in .env (deploy-time,
          an engineer's call) — see .env.example and deploy-dev.sh. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agent Mode</label>
        <div style={{ fontSize: 12, padding: '7px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          {currentMode === 'agentcore' ? 'AgentCore Runtime' : 'Local'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Set via <code>AGENT_MODE</code> at deploy time, not changeable from here.
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

      {/* AgentCore region — Runtime + Browser. Hidden unless an AgentCore
          Runtime is actually deployed for this environment
          (ENABLE_AGENTCORE=true) — meaningless otherwise. */}
      {agentcoreEnabled && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          AgentCore Region <span style={{ fontWeight: 400, textTransform: 'none' }}>(Runtime + Browser)</span>
        </label>
        <select
          className="form-input"
          value={browserRegion}
          onChange={(e) => { setBrowserRegion(e.target.value); setRegionDirty(true) }}
        >
          {knownRegions.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="__custom__">Custom region…</option>
        </select>
        {browserRegion === '__custom__' && (
          <input
            type="text"
            className="form-input"
            value={browserRegionCustom}
            onChange={(e) => { setBrowserRegionCustom(e.target.value); setRegionDirty(true) }}
            placeholder="e.g. ap-southeast-1"
            style={{ marginTop: 5 }}
          />
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Where AgentCore Runtime and AgentCore Browser sessions live. Defaults to the same region as the EC2 host.
        </div>
      </div>
      )}
    </Modal>
  )
}
