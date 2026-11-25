/**
 * Masking for stored secrets (account passwords, secret context variables).
 * The API returns MASK in place of a stored value. Sending MASK back on a save means
 * "keep what is stored", so a client that never saw the value cannot wipe it.
 * Real values leave the backend only through the explicit reveal endpoints.
 */
export const MASK = '••••••••';

export function maskedAccounts(accounts) {
  return accounts.map(a => ({ role: a.role, username: a.username, passwordSet: !!a.password, password: a.password ? MASK : '' }));
}

export function maskedEnvVars(vars) {
  return vars.map(v => (v.secret ? { ...v, value: v.value ? MASK : '', valueSet: !!v.value } : v));
}

/** Replace MASK values in an incoming list with the stored ones. Returns { list } or { error }. */
export function resolveEnvVars(incoming, stored) {
  const byName = new Map(stored.map(v => [v.name, v.value]));
  const list = [];
  for (const [i, v] of incoming.entries()) {
    if (v?.secret && v.value === MASK) {
      const name = String(v.name || '').trim();
      if (!byName.has(name)) return { error: `Variable ${i + 1} (${name}): no stored value to keep, enter one` };
      list.push({ ...v, value: byName.get(name) });
    } else list.push(v);
  }
  return { list };
}
