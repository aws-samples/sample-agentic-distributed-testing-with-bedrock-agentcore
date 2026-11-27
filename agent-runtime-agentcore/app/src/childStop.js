/**
 * Stops an agent run when its caller goes away (issue #40): the backend aborts the
 * request on its per-case timeout or on Stop, and the agent child must not keep
 * running in the browser tab while the retry or the next case starts.
 * Same file in agent-runtime-local/src/childStop.js, tested there (test/childStop.test.js).
 */

// sessionName -> AbortController of that session's run_test request in flight.
const inflight = new Map();

// One AbortController per run_test request. It aborts when the client closes the
// connection before the response is finished, when killSession(sessionName) is
// called, or when a newer run for the same session starts (one agent per tab).
export function trackRun(sessionName, res) {
  inflight.get(sessionName)?.abort();
  const ctrl = new AbortController();
  inflight.set(sessionName, ctrl);
  const onClose = () => { if (!res.writableFinished) ctrl.abort(); };
  res.on('close', onClose);
  return {
    signal: ctrl.signal,
    done() {
      res.off('close', onClose);
      if (inflight.get(sessionName) === ctrl) inflight.delete(sessionName);
    },
  };
}

// Aborts the session's run in flight, if any. Returns true when there was one.
export function killSession(sessionName) {
  const ctrl = inflight.get(sessionName);
  if (!ctrl) return false;
  inflight.delete(sessionName);
  ctrl.abort();
  return true;
}

// Kills `child` (SIGTERM, as /kill does) when `signal` aborts, then calls onAbort.
export function killChildOnAbort(child, signal, onAbort) {
  if (!signal) return;
  const stop = () => {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    onAbort?.();
  };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
}
