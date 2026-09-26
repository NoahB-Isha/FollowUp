import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Publish a release that installed apps can self-update from:
 *   1. bump "version" in package.json, commit, push
 *   2. npm run release
 *
 * Builds everything, then creates GitHub release v<version> carrying:
 *   - followup-bundle-<v>.cjs (+ .sha256)  ← what installed apps download
 *   - the four light server zips           ← for fresh installs of that tier
 * Desktop DMGs/zips (2.3+ GB, model inside) exceed GitHub's asset limit and
 * are passed around by Drive/AirDrop — only needed when node/llama/the model
 * or the window shell change, which a bundle update can't deliver.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TAG = `v${VERSION}`;

const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }) ?? '').trim();

// ---------- guards ----------
if (run('git', ['status', '--porcelain'])) {
  console.error('release: commit (or stash) your changes first — the tag must match the code.');
  process.exit(1);
}
run('git', ['fetch', 'origin', 'main'], { stdio: 'ignore' });
if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) {
  console.error('release: push to origin/main first — the release tag is created on the remote.');
  process.exit(1);
}
try {
  run('gh', ['release', 'view', TAG], { stdio: 'ignore' });
  console.error(`release: ${TAG} already exists. Bump "version" in package.json first.`);
  process.exit(1);
} catch { /* good — no such release */ }

// ---------- build ----------
console.log(`building ${TAG}…`);
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const bundleSrc = path.join(DIST, 'bundle.cjs');
const bundleOut = path.join(DIST, `followup-bundle-${VERSION}.cjs`);
copyFileSync(bundleSrc, bundleOut);
const sha = createHash('sha256').update(readFileSync(bundleOut)).digest('hex');
writeFileSync(`${bundleOut}.sha256`, `${sha}  followup-bundle-${VERSION}.cjs\n`);

// ---------- publish ----------
const assets = [
  bundleOut,
  `${bundleOut}.sha256`,
  path.join(DIST, 'FollowUp-macos-arm64.zip'),
  path.join(DIST, 'FollowUp-macos-intel.zip'),
  path.join(DIST, 'FollowUp-linux-x64.zip'),
  path.join(DIST, 'FollowUp-windows-x64.zip'),
];
execFileSync('gh', ['release', 'create', TAG,
  '--title', `FollowUp ${TAG}`,
  '--notes', `Installed apps update themselves to this version from the dashboard banner (~2 MB download).
The zips are the light server builds for fresh installs; desktop apps with the bundled model are distributed separately.`,
  '--generate-notes',
  ...assets,
], { cwd: ROOT, stdio: 'inherit' });

console.log(`\n✓ ${TAG} published — running apps will show the update banner within a day (or on next launch).`);
