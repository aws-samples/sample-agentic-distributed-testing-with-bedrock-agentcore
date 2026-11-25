/**
 * Runs one test case with a per-attempt timeout, Stop support and bounded retries
 * for ERROR (issue #40). No store/db dependency, so it can be unit-tested
 * (see test/caseAttempts.test.js).
 */
import { isThrottle } from './verdict.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// invoke(signal) -> Promise<{ status, reason, throttled? }>; it may also throw.
// Returns { status, reason, attempts: [{ n, status, reason, startedAt, endedAt }] }.
export async function runCaseWithAttempts(invoke, {
  timeoutMs = 600_000,
  maxRetries = 1,
  isStopped = () => false,
  backoffMs = 2_000,
  throttleBackoffMs = 10_000,
  pollMs = 250,
  onAttempt,
} = {}) {
  const attempts = [];
  for (let n = 1; ; n++) {
    const startedAt = new Date().toISOString();
    onAttempt?.(n);
    const { status, reason, throttled } = await oneAttempt(invoke, { timeoutMs, isStopped, pollMs });
    attempts.push({ n, status, reason, startedAt, endedAt: new Date().toISOString() });

    if (status !== 'ERROR' || n > maxRetries || isStopped()) return { status, reason, attempts };
    await sleep((throttled ? throttleBackoffMs : backoffMs) * 2 ** (n - 1));
    if (isStopped()) return { status: 'SKIPPED', reason: 'Stopped by user before retry', attempts };
  }
}

async function oneAttempt(invoke, { timeoutMs, isStopped, pollMs }) {
  const ctrl = new AbortController();
  let cause = null;
  const abort = (why) => { if (!cause) { cause = why; ctrl.abort(new Error(why)); } };
  const timer = setTimeout(() => abort('timeout'), timeoutMs);
  const poll = setInterval(() => { if (isStopped()) abort('stopped'); }, pollMs);
  // Ends the attempt even if invoke ignores the signal (a hung call).
  const aborted = new Promise(resolve => ctrl.signal.addEventListener('abort', resolve, { once: true }));
  try {
    const result = await Promise.race([invoke(ctrl.signal), aborted]);
    if (!cause) return { status: result.status, reason: result.reason || '', throttled: !!result.throttled };
  } catch (e) {
    if (!cause) return { status: 'ERROR', reason: `Runtime error: ${e?.message || e}`, throttled: isThrottle(e) };
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
  if (cause === 'stopped') return { status: 'SKIPPED', reason: 'Stopped by user' };
  return { status: 'ERROR', reason: `ERROR: timeout after ${timeoutMs / 1000}s` };
}
