import { createHash } from 'node:crypto';
import { existsSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { paths } from './config.js';
import { fetchUpload } from './jotform.js';

const run = promisify(execFile);

/**
 * Photo cache: originals and thumbnails are content-addressed by URL hash and
 * immutable once written. Originals come from JotForm (server-side, keyed);
 * thumbnails are generated locally with macOS's built-in `sips` (zero deps) —
 * a 2.4 MB iPhone photo becomes a ~40 KB thumb. Falls back to the original
 * when sips isn't available (e.g. on a Linux Pi until sharp is added).
 */

const inflight = new Map(); // url|kind → Promise<string path>  (dedupes concurrent requests)
let sipsBroken = false;

function hashOf(url) {
  return createHash('sha1').update(url).digest('hex');
}

function extOf(url) {
  return (url.match(/\.(jpe?g|png|gif|webp|heic)([?#]|$)/i)?.[1] || 'jpg').toLowerCase();
}

export function originalPath(url) {
  return path.join(paths.photoCache, `${hashOf(url)}.${extOf(url)}`);
}

export function thumbPath(url) {
  return path.join(paths.photoCache, `${hashOf(url)}_t.jpg`);
}

function dedupe(key, fn) {
  let p = inflight.get(key);
  if (!p) {
    p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Download the original into the cache (once), return its path. */
export function ensureOriginal(url) {
  const file = originalPath(url);
  if (existsSync(file)) return Promise.resolve(file);
  return dedupe(`orig|${url}`, async () => {
    if (existsSync(file)) return file;
    const res = await fetchUpload(url);
    const tmp = `${file}.${process.pid}.part`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    renameSync(tmp, file); // atomic: readers never see a half-written photo
    return file;
  });
}

/** Ensure a ~480px thumbnail exists; returns its path, or the original on failure. */
export function ensureThumb(url) {
  const thumb = thumbPath(url);
  if (existsSync(thumb)) return Promise.resolve(thumb);
  return dedupe(`thumb|${url}`, async () => {
    if (existsSync(thumb)) return thumb;
    const orig = await ensureOriginal(url);
    if (sipsBroken) return orig;
    // Temp name is per-process so the server and a concurrent `npm run warm`
    // can never interleave writes to the same file.
    const tmp = path.join(paths.photoCache, `.${hashOf(url)}_t.${process.pid}.tmp.jpg`);
    try {
      await run('sips', ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', orig, '--out', tmp]);
      renameSync(tmp, thumb);
      return thumb;
    } catch (err) {
      if (err.code === 'ENOENT') sipsBroken = true; // no sips on this OS — serve originals
      try { unlinkSync(tmp); } catch { /* nothing to clean */ }
      return orig;
    }
  });
}

/**
 * Pre-fetch originals + thumbs with bounded concurrency so the first dashboard
 * visit is instant. Called from sync for newly seen walkthroughs.
 */
export async function warmup(urls, { concurrency = 4, onError } = {}) {
  const queue = [...urls];
  let done = 0;
  async function worker() {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        await ensureThumb(url);
        done++;
      } catch (err) {
        onError?.(url, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return done;
}
