/**
 * Masks secret values (account passwords, secret context variables) in text that is
 * shown to people: the live test case log, the step feed, verdict reasons, run history.
 *
 * Secrets shorter than MIN_SECRET_LENGTH are not masked: a short value (the demo login
 * "PASSWORD" is 8, but a PIN is 4) would mangle ordinary words everywhere in the log.
 * The agent streams text in small pieces, so a secret can arrive split across them:
 * createRedactingBuffer joins the pieces and only lets text out where no secret can cross the cut.
 * shortcut: exact-match only. A secret the agent transforms (encodes, spells out, partly
 * quotes) is not caught; upgrade with fuzzy matching if that matters.
 */
export const REDACTED = '[redacted]';
export const MIN_SECRET_LENGTH = 6;
// Text held back before it is let out even with no line or sentence end (a secret that crosses
// this cut is still held back whole, see safeCut).
export const FLUSH_AT = 400;

// The secrets that are masked, longest first so a secret that is a prefix of another can't leave a tail.
function secretList(secrets) {
  return [...new Set((secrets || []).map(s => String(s ?? '')).filter(x => x.length >= MIN_SECRET_LENGTH))]
    .sort((a, b) => b.length - a.length);
}

export function redactSecrets(text, secrets) {
  let out = String(text ?? '');
  for (const s of secretList(secrets)) out = out.split(s).join(REDACTED);
  return out;
}

// Moves `cut` back until no secret crosses it: neither a whole secret that starts before it and
// ends after it, nor the start of a secret whose rest has not arrived yet.
function safeCut(buf, cut, list) {
  for (let moved = true; moved && cut > 0;) {
    moved = false;
    for (const s of list) {
      for (let p = Math.max(0, cut - s.length + 1); p < cut; p++) {
        const piece = buf.slice(p, p + s.length);
        if (piece === s || (p + s.length > buf.length && s.startsWith(piece))) { cut = p; moved = true; break; }
      }
    }
  }
  return cut;
}

// End of the last full line or sentence in `buf` (0 if none).
function boundary(buf) {
  let c = buf.lastIndexOf('\n') + 1;
  for (const e of ['. ', '! ', '? ']) { const i = buf.lastIndexOf(e); if (i >= 0) c = Math.max(c, i + e.length); }
  return c;
}

/**
 * Collects streamed text pieces and calls emit(maskedText) per line or sentence, when FLUSH_AT
 * characters are waiting, and on flush() (end of the text, before a tool step, end of stream).
 * getSecrets() is read at every cut, so a secret changed in Settings mid-run is used at once.
 */
export function createRedactingBuffer(getSecrets, emit, { flushAt = FLUSH_AT } = {}) {
  let buf = '';
  const out = (text, secrets) => { if (text) emit(redactSecrets(text, secrets)); };
  return {
    push(piece) {
      buf += String(piece ?? '');
      const secrets = getSecrets();
      const cut = safeCut(buf, buf.length >= flushAt ? buf.length : boundary(buf), secretList(secrets));
      if (cut > 0) { out(buf.slice(0, cut), secrets); buf = buf.slice(cut); }
    },
    flush() {
      out(buf, getSecrets());
      buf = '';
    },
  };
}
