/**
 * Snapshot capture & S3 upload.
 *
 * As tests run, the agent runtime streams screenshot frames at ~2fps. We
 * sample those frames per (runId, tcId) — capping at MAX_FRAMES_PER_TC to
 * keep memory bounded and to avoid uploading hundreds of near-duplicate
 * frames. At test_result time we upload everything we buffered to S3
 * and return the object keys so they can be stored in the run archive.
 * The frontend gets presigned URLs on demand (the bucket is private).
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.S3_SNAPSHOT_BUCKET;
const REGION = process.env.S3_SNAPSHOT_REGION || 'ap-southeast-1';
const MAX_FRAMES_PER_TC = 6;  // keep at most N evenly-sampled frames per TC
// A 1024×~680 JPEG of a uniform-colour page (e.g. about:blank white) compresses
// to ~5 KB. Real page screenshots are typically 25-80 KB. Anything smaller than
// this threshold is almost certainly a blank/loading frame that has no evidentiary
// value, so we skip it. Threshold is in *decoded* bytes (post base64 → buffer).
const BLANK_FRAME_BYTE_THRESHOLD = 8 * 1024;

let _client = null;
function client() {
  if (!_client) _client = new S3Client({ region: REGION });
  return _client;
}

export function isEnabled() {
  return !!BUCKET;
}

// In-memory buffer: bufferKey = `${runId}::${tcId}` → [{ ts, action, b64 }]
const buffers = new Map();

function bufferKey(runId, tcId) { return `${runId}::${tcId}`; }

/**
 * Heuristic: is this frame a mostly-blank (white/uniform) page?
 * A uniform-colour JPEG of the typical 1024×~680 viewport compresses to
 * around 5 KB. Real screenshots with text/UI run 25-80 KB. So any frame
 * below ~8 KB decoded is almost certainly an about:blank / loading frame.
 *
 * We rely on JPEG's compression properties rather than decoding pixels —
 * this stays dependency-free and is O(1) per frame.
 */
function isLikelyBlankFrame(b64) {
  if (!b64) return true;
  // base64 → byte length is roughly 3/4 of the string length (minus padding).
  // Skip the actual decode for the fast path.
  const approxBytes = Math.floor(b64.length * 0.75);
  return approxBytes < BLANK_FRAME_BYTE_THRESHOLD;
}

/**
 * Called every time a screenshot frame arrives during a TC run.
 * Keeps the most recent frames so we have evidence of the final state at
 * verdict time. Mostly-blank frames (e.g. about:blank captured before the
 * page finished navigating) are skipped — they have no evidentiary value
 * and crowd out the meaningful frames in the bounded buffer.
 */
export function recordFrame(runId, tcId, b64, action = '') {
  if (!isEnabled() || !runId || !tcId || !b64) return;
  // Drop blank/loading frames so they don't dominate the buffer or get
  // surfaced as evidence on the Analysis page.
  if (isLikelyBlankFrame(b64)) return;
  const key = bufferKey(runId, tcId);
  const frames = buffers.get(key) || [];
  frames.push({ ts: new Date().toISOString(), action: (action || '').slice(0, 200), b64 });
  // Cap memory: keep the most recent MAX_FRAMES_PER_TC frames. We used to
  // also retain the very first frame, but that frame is often captured
  // pre-navigation (about:blank), which surfaced as a blank evidence tile
  // on the Analysis page. Newest-N is a better fit: the last frame is the
  // verdict-time screenshot, which is the most important evidence.
  if (frames.length > MAX_FRAMES_PER_TC) {
    buffers.set(key, frames.slice(-MAX_FRAMES_PER_TC));
  } else {
    buffers.set(key, frames);
  }
}

/**
 * Upload all buffered frames for this TC to S3, returning the object keys
 * (plus per-frame metadata) so they can be stored in the run archive.
 * Buffer is cleared after upload.
 */
export async function flushTcSnapshots(runId, tcId) {
  if (!isEnabled()) return [];
  const key = bufferKey(runId, tcId);
  const frames = buffers.get(key) || [];
  buffers.delete(key);
  if (frames.length === 0) return [];

  const results = [];
  const c = client();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const seq = String(i + 1).padStart(2, '0');
    const objectKey = `runs/${runId}/${tcId}/${seq}.png`;
    try {
      const bytes = Buffer.from(f.b64, 'base64');
      // chrome-devtools-mcp returns JPEG-encoded base64 by default but the
      // .png extension is harmless — browsers sniff the content type.
      await c.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        Body: bytes,
        ContentType: 'image/jpeg',
        Metadata: { tcid: tcId, runid: runId, action: f.action || '' },
      }));
      results.push({ key: objectKey, ts: f.ts, action: f.action, seq: i + 1 });
    } catch (e) {
      console.error(`[snapshots] upload failed for ${objectKey}:`, e.message);
    }
  }
  return results;
}

/**
 * Get a presigned GET URL for an object so the frontend can render the image.
 * The bucket is private; URLs expire after 5 minutes.
 */
export async function getSnapshotUrl(objectKey) {
  if (!isEnabled()) throw new Error('S3_SNAPSHOT_BUCKET not configured');
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: objectKey });
  return getSignedUrl(client(), cmd, { expiresIn: 300 });
}

