import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, chmodSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Package FollowUp into single-file executables (Node SEA):
 *   npm run build            → all targets
 *   npm run build -- --host  → just this machine's platform (for testing)
 *
 * Steps: embed web assets → esbuild bundle (CJS) → SEA blob (platform-
 * independent: no snapshot/code cache) → inject into official Node binaries
 * per target → zip with a README. Nothing secret is embedded: tokens/.env/
 * data live in the user's ~/FollowUp.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.build-cache');
const NODE_VERSION = process.version; // match the dev runtime
const HOST_ONLY = process.argv.includes('--host');

const TARGETS = [
  { name: 'macos-arm64', tarball: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, plat: 'darwin', arch: 'arm64' },
  { name: 'macos-intel', tarball: `node-${NODE_VERSION}-darwin-x64.tar.gz`, plat: 'darwin', arch: 'x64' },
  { name: 'linux-x64', tarball: `node-${NODE_VERSION}-linux-x64.tar.gz`, plat: 'linux', arch: 'x64' },
  { name: 'windows-x64', zip: `node-${NODE_VERSION}-win-x64.zip`, plat: 'win32', arch: 'x64' },
];

mkdirSync(DIST, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// ---------- 1. Embedded assets module ----------
const webDir = path.join(ROOT, 'src', 'web');
const embedded = {
  'styles.css': readFileSync(path.join(webDir, 'styles.css'), 'utf8'),
};
for (const f of ['bricolage-var.woff2', 'jakarta-var.woff2']) {
  embedded[`fonts/${f}`] = readFileSync(path.join(webDir, 'fonts', f)).toString('base64');
}
const embeddedPath = path.join(CACHE, 'embedded.gen.js');
writeFileSync(embeddedPath, `export const EMBEDDED = ${JSON.stringify(embedded)};\n`);

// ---------- 2. Bundle ----------
const bundlePath = path.join(DIST, 'bundle.cjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'app.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundlePath,
  plugins: [{
    name: 'swap-embedded',
    setup(b) {
      b.onResolve({ filter: /^\.\/embedded\.js$/ }, () => ({ path: embeddedPath }));
    },
  }],
  define: { 'import.meta.url': '__followup_meta_url' },
  banner: { js: `const __followup_meta_url = require('node:url').pathToFileURL(__filename).href;` },
  logLevel: 'warning',
});
console.log(`bundled → ${path.relative(ROOT, bundlePath)} (${(readFileSync(bundlePath).length / 1024).toFixed(0)} KB)`);

// ---------- 3. SEA blob (platform-independent) ----------
const seaConfig = path.join(CACHE, 'sea-config.json');
const blobPath = path.join(CACHE, 'followup.blob');
writeFileSync(seaConfig, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// ---------- 4. Per-target injection ----------
async function download(url, dest) {
  if (existsSync(dest)) return;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function extractNodeBinary(archivePath, target) {
  const out = path.join(CACHE, `node-${target.name}${target.plat === 'win32' ? '.exe' : ''}`);
  if (existsSync(out)) return out;
  if (target.tarball) {
    const inner = `${target.tarball.replace('.tar.gz', '')}/bin/node`;
    execFileSync('tar', ['-xzf', archivePath, '-C', CACHE, inner]);
    copyFileSync(path.join(CACHE, inner), out);
  } else {
    const inner = `${target.zip.replace('.zip', '')}/node.exe`;
    execFileSync('unzip', ['-o', '-q', archivePath, inner, '-d', CACHE]);
    copyFileSync(path.join(CACHE, inner), out);
  }
  chmodSync(out, 0o755);
  return out;
}

const hostName = `${process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`.replace('macos-x64', 'macos-intel');
const targets = HOST_ONLY ? TARGETS.filter((t) => t.name === hostName) : TARGETS;

for (const t of targets) {
  const archive = t.tarball ?? t.zip;
  const archivePath = path.join(CACHE, archive);
  await download(`https://nodejs.org/dist/${NODE_VERSION}/${archive}`, archivePath);
  const nodeBin = extractNodeBinary(archivePath, t);

  const exeName = t.plat === 'win32' ? 'FollowUp.exe' : 'FollowUp';
  const exePath = path.join(DIST, `${t.name}-${exeName}`);
  copyFileSync(nodeBin, exePath);
  chmodSync(exePath, 0o755);

  if (t.plat === 'darwin') execFileSync('codesign', ['--remove-signature', exePath]);
  execFileSync('npx', ['--yes', 'postject', exePath, 'NODE_SEA_BLOB', blobPath,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(t.plat === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ], { stdio: 'inherit' });
  if (t.plat === 'darwin') execFileSync('codesign', ['-s', '-', exePath]);

  // Zip: executable + a short read-me
  const stage = path.join(CACHE, `stage-${t.name}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(exePath, path.join(stage, exeName));
  chmodSync(path.join(stage, exeName), 0o755);
  writeFileSync(path.join(stage, 'README.txt'),
`FollowUp — lodge walkthrough dashboard
=====================================
1. Double-click ${exeName} (macOS: right-click → Open the first time,
   since it isn't notarized). A terminal window stays open while it runs.
2. Your browser opens http://localhost:4820 — upload the setup token you
   were sent and enter its passphrase.
3. That's it. It syncs itself every few hours while running, keeps daily
   backups, and stores everything in ~/FollowUp (Windows: %USERPROFILE%\\FollowUp).

Close the terminal window to stop FollowUp. Start it again any time —
your data is kept.
`);
  const zipPath = path.join(DIST, `FollowUp-${t.name}.zip`);
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-j', '-q', zipPath, path.join(stage, exeName), path.join(stage, 'README.txt')]);
  console.log(`✓ ${path.relative(ROOT, zipPath)}`);
}
console.log('done.');
