// Read the JSON object out of a model reply.
//
// Models often wrap the JSON in a ```json fence or add a note after it (sometimes
// with braces of its own). Slicing from the first "{" to the last "}" then gives
// text that is not JSON. Instead this reads the FIRST complete object: it counts
// braces and ignores braces inside strings (including escaped quotes).

/**
 * Returns { value } with the first JSON object found in `text`, or { error } with
 * the reason it could not be read (for the log, not for the user).
 */
export function extractJsonObject(text) {
  const s = String(text ?? '');
  // A fenced block, when there is one, is the answer; otherwise look in the whole reply.
  const fence = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i.exec(s);
  const candidates = fence ? [fence[1], s] : [s];
  let reason = 'no JSON object in the reply';
  for (const src of candidates) {
    let from = 0;
    for (;;) {
      const start = src.indexOf('{', from);
      if (start === -1) break;
      const end = matchingBrace(src, start);
      if (end === -1) { reason = 'the JSON object is cut off (no closing brace)'; break; }
      try {
        const value = JSON.parse(src.slice(start, end + 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
        reason = 'the JSON is not an object';
      } catch (e) {
        reason = `invalid JSON: ${e.message}`;
      }
      from = end + 1;   // braces in prose such as "{balance}": try the next one
    }
  }
  return { error: reason };
}

// Index of the "}" that closes the "{" at `start`, or -1 when the text ends first.
function matchingBrace(s, start) {
  let depth = 0, inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;                 // skip the escaped character, such as \" or \\
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
