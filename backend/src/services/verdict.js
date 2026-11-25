/**
 * Turns what the agent runtime streamed back into a test-case status. Pure, so it
 * can be unit-tested (see test/verdict.test.js).
 *
 * Only a structured verdict counts: the agent's assert_pass / assert_fail tool call.
 * Free text is never read for words like "pass" or "verified" (issue #40): without a
 * verdict the case is ERROR, an infrastructure outcome kept apart from a product FAIL.
 */

// PASS / FAIL: the agent's verdict on the product. ERROR: no verdict (runtime error,
// timeout, throttling, no assert call). SKIPPED: not run, or stopped by the user.
export const STATUSES = ['PASS', 'FAIL', 'ERROR', 'SKIPPED'];

// assertResult: { passed, reason } from an assert_pass / assert_fail tool call, or null.
// text: the agent's streamed text, used only to explain an ERROR.
export function verdictFromAgentOutput(assertResult, text = '') {
  if (assertResult) {
    let reason = assertResult.reason || '';
    try { const p = JSON.parse(reason); reason = p.reason || reason; } catch { /* keep raw */ }
    return { status: assertResult.passed ? 'PASS' : 'FAIL', reason };
  }
  const tail = text.trim().slice(-200);
  return { status: 'ERROR', reason: tail ? `No verdict from agent: ${tail}` : 'No verdict from agent (empty output)' };
}

// AgentCore / AWS SDK throttling: retried with a longer backoff.
export function isThrottle(err) {
  return err?.name === 'ThrottlingException' || err?.name === 'TooManyRequestsException'
    || err?.$metadata?.httpStatusCode === 429 || /\b429\b|throttl/i.test(err?.message || '');
}
