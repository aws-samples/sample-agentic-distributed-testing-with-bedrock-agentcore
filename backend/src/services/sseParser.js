/**
 * Streaming parser for the agent runtime's SSE output ("data: {event}" lines).
 * Side effects go through a `sink` ({ screenshot(base64), step(text, kind) }) so this
 * module has no store/db dependency and can be unit-tested (see sseParser.test.js).
 */

// Stateful: feedLine() takes one line as it arrives (so the live log can follow the
// agent), finish() returns the verdict once the stream has ended.
export function createSseParser(sink) {
  const textParts = [];
  let assertResult = null;

  function feedLine(line) {
    if (!line.startsWith('data: ')) return;
    try {
      const ev = JSON.parse(line.slice(6))?.event;
      if (!ev) return;

      if (ev.screenshot?.data) {
        sink.screenshot(ev.screenshot.data);
        return;
      }

      const imgSource = ev.contentBlockStart?.start?.image?.source;
      if (imgSource?.type === 'base64' && imgSource.data) sink.screenshot(imgSource.data);

      const textDelta = ev.contentBlockDelta?.delta?.text;
      if (textDelta) { textParts.push(textDelta); sink.step(textDelta, 'text'); }

      const toolStart = ev.contentBlockStart?.start?.toolUse;
      if (toolStart?.name && toolStart.name !== 'assert_pass' && toolStart.name !== 'assert_fail') sink.step(`\u2192 ${toolStart.name}`, 'tool');
      if (toolStart?.name === 'assert_pass') assertResult = { passed: true, reason: '' };
      else if (toolStart?.name === 'assert_fail') assertResult = { passed: false, reason: '' };

      const inputDelta = ev.contentBlockDelta?.delta?.toolUse?.input;
      if (inputDelta && assertResult) assertResult.reason += inputDelta;
    } catch { /* skip */ }
  }

  function finish() {
    if (assertResult) {
      try { const p = JSON.parse(assertResult.reason); assertResult.reason = p.reason || assertResult.reason; } catch { /* keep raw */ }
      return assertResult;
    }

    const text = textParts.join('');
    if (!text) return { passed: false, reason: 'No result from runtime' };
    try {
      const m = text.match(/\{"passed"\s*:\s*(true|false)[^}]*\}/);
      if (m) { const p = JSON.parse(m[0]); return { passed: p.passed, reason: p.reason || text.slice(-200) }; }
    } catch { /* ignore */ }
    const tail = text.slice(-500).toLowerCase();
    if (tail.includes('pass') || tail.includes('success') || tail.includes('verified')) return { passed: true, reason: text.slice(-200) };
    return { passed: false, reason: text.slice(-200) };
  }

  return { feedLine, finish };
}

// Bytes in, verdict out. A network chunk can end mid-line or inside a multi-byte UTF-8
// character, so decode in streaming mode and only feed complete lines.
export function createSseStream(sink) {
  const parser = createSseParser(sink);
  const decoder = new TextDecoder();
  let buf = '';
  return {
    write(bytes) {
      buf += decoder.decode(bytes, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) parser.feedLine(line);
    },
    end() {
      buf += decoder.decode();
      if (buf) parser.feedLine(buf);
      buf = '';
      return parser.finish();
    },
  };
}
