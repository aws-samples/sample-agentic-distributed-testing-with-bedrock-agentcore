import { useState } from 'react'
import Btn from './Btn'
import styles from './SettingsModal.module.css'

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
export const MODEL_IDS = MODEL_GROUPS.flatMap(g => g.models)


export const KNOWN_REGIONS_FALLBACK = [
  'us-east-1', 'us-east-2', 'us-west-2',
  'eu-west-1', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
]

/** Split a stored value into the dropdown's state: a listed choice, or "__custom__" + text. */
export function toChoice(value, known) {
  if (!value) return { choice: '', custom: '' }
  return known.includes(value) ? { choice: value, custom: '' } : { choice: '__custom__', custom: value }
}
export const fromChoice = ({ choice, custom }) => (choice === '__custom__' ? custom.trim() : choice)

/**
 * A Bedrock model id + region pair with a "Check" button that makes a tiny real
 * call to confirm the model works in that region. Used once for the platform's
 * own AI features and once for the testing agent.
 *
 * `model` / `region` are { choice, custom } objects (see toChoice); `onChange`
 * receives the new pair. `api.checkModelHealth(model, region)` does the check.
 */
export function ModelRegionPicker({ idPrefix, model, region, knownRegions, onChange, api, current, regionNote }) {
  const [health, setHealth] = useState({ text: '', color: 'var(--text-muted)', loading: false })
  const modelId = fromChoice(model)
  const regionId = fromChoice(region)

  const check = async () => {
    if (!modelId) return setHealth({ text: 'Select a model first', color: 'var(--yellow)', loading: false })
    if (!regionId) return setHealth({ text: 'Select a region first', color: 'var(--yellow)', loading: false })
    setHealth({ text: 'Checking…', color: 'var(--text-muted)', loading: true })
    try {
      const d = await api.checkModelHealth(modelId, regionId)
      setHealth(d.ok
        ? { text: `✓ Works in ${d.region}`, color: 'var(--green)', loading: false }
        : { text: '✗ ' + (d.error || 'Failed'), color: 'var(--red)', loading: false })
    } catch (e) {
      setHealth({ text: '✗ ' + e.message, color: 'var(--red)', loading: false })
    }
  }
  const touch = (patch) => { setHealth({ text: '', color: 'var(--text-muted)', loading: false }); onChange(patch) }

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-model`}>Bedrock model</label>
        <select id={`${idPrefix}-model`} className="form-input" value={model.choice}
          onChange={(e) => touch({ model: { choice: e.target.value, custom: model.custom } })}>
          {!model.choice && <option value="" disabled>Select a model…</option>}
          {MODEL_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.models.map(id => <option key={id} value={id}>{id}</option>)}
            </optgroup>
          ))}
          <optgroup label="Custom"><option value="__custom__">Custom model ID…</option></optgroup>
        </select>
        {model.choice === '__custom__' && (
          <input type="text" className="form-input" value={model.custom} placeholder="Enter full Bedrock model ID"
            onChange={(e) => touch({ model: { choice: '__custom__', custom: e.target.value } })} style={{ marginTop: 5 }} />
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-region`}>Bedrock region</label>
        <select id={`${idPrefix}-region`} className="form-input" value={region.choice}
          onChange={(e) => touch({ region: { choice: e.target.value, custom: region.custom } })}>
          {knownRegions.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="__custom__">Custom region…</option>
        </select>
        {region.choice === '__custom__' && (
          <input type="text" className="form-input" value={region.custom} placeholder="e.g. us-east-1"
            onChange={(e) => touch({ region: { choice: '__custom__', custom: e.target.value } })} style={{ marginTop: 5 }} />
        )}
        {regionNote && <div className={styles.hint}>{regionNote}</div>}
      </div>

      <div className={styles.check}>
        <Btn size="sm" onClick={check} disabled={health.loading}>Check model</Btn>
        <span style={{ color: health.color }}>{health.text}</span>
        {current && !health.text && <span className={styles.hint} style={{ margin: 0 }}>Saved: <code>{current}</code></span>}
      </div>
    </>
  )
}
