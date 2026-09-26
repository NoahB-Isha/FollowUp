import pkg from '../package.json' with { type: 'json' };

/**
 * The app version, baked into the bundle at build time (esbuild inlines the
 * JSON import). package.json is the single source of truth — the desktop
 * builds and the release script read the same field.
 */
export const APP_VERSION = pkg.version;

/** Compare dotted versions numerically: -1 / 0 / 1. Ignores a leading "v". */
export function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
