/**
 * Masks secret values (account passwords, secret context variables) in text that is
 * shown to people: the live test case log, the step feed, verdict reasons, run history.
 *
 * shortcut: exact-match only. A secret split across two streamed text deltas, or
 * transformed (encoded, partly quoted) by the agent, is not caught. Upgrade by
 * buffering deltas per line if that matters.
 */
export const REDACTED = '[redacted]';

export function redactSecrets(text, secrets) {
  let out = String(text ?? '');
  const list = [...new Set((secrets || []).map(s => String(s ?? '')).filter(Boolean))]
    .sort((a, b) => b.length - a.length);               // longest first, so a prefix secret can't leave a tail
  for (const s of list) out = out.split(s).join(REDACTED);
  return out;
}
