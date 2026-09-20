import { existsSync } from 'node:fs';
import { q } from './db.js';
import { warmup, thumbPath } from './photos.js';

/**
 * Backfill the photo cache (originals + thumbnails) for every photo in the DB.
 * One-time cost after adopting thumbnails, or after clearing data/photocache.
 * Normal operation doesn't need this — sync warms new photos as they arrive.
 */
const urls = q('SELECT url FROM photos').all().map((r) => r.url);
const pending = urls.filter((u) => !existsSync(thumbPath(u)));
console.log(`${urls.length} photos in DB, ${pending.length} need warming…`);

const t0 = performance.now();
let failed = 0;
const done = await warmup(pending, {
  concurrency: 6,
  onError: (url, err) => { failed++; console.error(`  ✗ ${err.message} …${url.slice(-40)}`); },
});
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`Warmed ${done}/${pending.length} in ${secs}s${failed ? ` (${failed} failed — will retry lazily on view)` : ''}.`);
