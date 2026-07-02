import { Router } from 'express';
import { runArchive } from '../state/archive.js';
import { getSnapshotUrl, isEnabled as snapshotsEnabled } from '../services/snapshots.js';

const router = Router();

// List all archived runs (no screenshots — lightweight index)
router.get('/analysis/runs', (req, res) => {
  const list = runArchive.map(({ runId, startedAt, completedAt, stopped, targetUrl, summary }) => ({
    runId,
    startedAt,
    completedAt,
    stopped,
    targetUrl,
    summary,
  }));
  res.json(list);
});

// Full RunRecord for a single run (includes snapshot keys and logs)
router.get('/analysis/runs/:runId', (req, res) => {
  const record = runArchive.find(r => r.runId === req.params.runId);
  if (!record) return res.status(404).json({ error: 'Run not found' });
  res.json(record);
});

// Mint a short-lived presigned URL for a private snapshot object so the
// browser can render the image. The bucket has no public access.
router.get('/analysis/snapshot-url', async (req, res) => {
  if (!snapshotsEnabled()) return res.status(503).json({ error: 'S3 snapshots not configured' });
  const key = (req.query.key || '').toString();
  if (!key || !key.startsWith('runs/')) return res.status(400).json({ error: 'invalid key' });
  // Only honour keys that actually belong to a run in our archive — prevents
  // this endpoint from being used to mint URLs for arbitrary keys
  const known = runArchive.some(r => Object.values(r.modules || {}).some(m =>
    (m.cases || []).some(c => (c.snapshots || []).some(s => s.key === key))));
  if (!known) return res.status(404).json({ error: 'snapshot not found in any archived run' });
  try {
    const url = await getSnapshotUrl(key);
    res.json({ url, expiresIn: 300 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
