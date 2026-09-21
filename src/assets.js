import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED } from './embedded.js';

/**
 * Web assets (stylesheet, fonts): disk in a dev checkout, embedded module in
 * the packaged executable.
 */

function webDir() {
  try { return path.join(path.dirname(fileURLToPath(import.meta.url)), 'web'); }
  catch { return null; }
}

/** @returns {Buffer|string} */
export function webAsset(rel) {
  const dir = webDir();
  if (dir) {
    try { return readFileSync(path.join(dir, rel), rel.endsWith('.css') ? 'utf8' : null); }
    catch { /* fall through to embedded */ }
  }
  const hit = EMBEDDED?.[rel];
  if (hit == null) throw new Error(`asset not found: ${rel}`);
  return typeof hit === 'string' && !rel.endsWith('.css') ? Buffer.from(hit, 'base64') : hit;
}
