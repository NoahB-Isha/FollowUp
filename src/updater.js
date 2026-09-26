import { readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, paths } from './config.js';
import { APP_VERSION, cmpVer } from './version.js';

/**
 * Self-updates. The packaged app (SEA binary, mac .app, Windows folder) never
 * modifies itself on disk — instead it downloads a newer JS bundle from the
 * repo's GitHub Releases into ~/FollowUp/updates and, on every start, runs the
 * newest verified one it finds there. The model, llama runtime, and shells
 * stay untouched, so an update is ~2 MB instead of the 2.4 GB reinstall.
 *
 * Safety: assets come only from the release of the repo named in config
 * (app.json → updates.repo), a SHA-256 published alongside the bundle is
 * verified before staging and again before every boot, and a `.booting`
 * marker catches a staged bundle that crashes before it starts serving —
 * the next launch rolls back to the built-in version and marks it bad.
 */

const BUNDLE_RE = /^bundle-(\d+(?:\.\d+)*)\.cjs$/;

const state = {
  latest: null,      // newest release version, e.g. "0.4.1" (null: none/unknown)
  url: '',           // release page for humans
  assetUrl: '',      // followup-bundle-<v>.cjs download
  shaUrl: '',        // its .sha256 sidecar
  selfUpdate: false, // packaged + bundle asset present + not previously crashed
  checkedAt: 0,
  error: '',
};

export function getUpdateState() {
  return state;
}

function updatesCfg() {
  const cfg = app.updates;
  return cfg && cfg.check !== false && cfg.repo ? cfg : null;
}

// ---------- checking ----------

export async function checkForUpdates() {
  const cfg = updatesCfg();
  if (!cfg) return state;
  try {
    const api = (cfg.api || 'https://api.github.com').replace(/\/+$/, '');
    const res = await fetch(`${api}/repos/${cfg.repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `FollowUp/${APP_VERSION}` },
      signal: AbortSignal.timeout(15_000),
    });
    state.checkedAt = Date.now();
    if (res.status === 404) { state.latest = null; state.error = ''; return state; } // no releases yet
    if (!res.ok) throw new Error(`GitHub replied ${res.status}`);
    const rel = await res.json();
    const ver = String(rel.tag_name || '').replace(/^v/, '');
    if (!/^\d+(\.\d+)*$/.test(ver)) throw new Error(`unrecognized release tag ${rel.tag_name}`);
    const asset = (n) => (rel.assets || []).find((a) => a.name === n)?.browser_download_url || '';
    state.latest = ver;
    state.url = rel.html_url || `https://github.com/${cfg.repo}/releases`;
    state.assetUrl = asset(`followup-bundle-${ver}.cjs`);
    state.shaUrl = asset(`followup-bundle-${ver}.cjs.sha256`);
    state.selfUpdate = !!(process.__followup_sea && state.assetUrl && state.shaUrl && !isBad(ver));
    state.error = '';
    if (cmpVer(ver, APP_VERSION) > 0) console.log(`[update] v${ver} is available (running v${APP_VERSION}).`);
  } catch (err) {
    state.error = err.message;
  }
  return state;
}

export function scheduleUpdateChecks() {
  if (!updatesCfg()) return;
  setTimeout(checkForUpdates, 20_000).unref();
  setInterval(checkForUpdates, 24 * 3600_000).unref();
}

// ---------- staging ----------

async function fetchAsset(url, maxBytes) {
  const u = new URL(url);
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !local) throw new Error(`refusing non-https download ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('update asset is implausibly large');
  return buf;
}

/** Download + verify the latest release bundle into the updates dir. */
export async function stageUpdate() {
  if (!state.latest && !(await checkForUpdates()).latest) throw new Error(state.error || 'no releases found');
  if (cmpVer(state.latest, APP_VERSION) <= 0) throw new Error('already up to date');
  if (isBad(state.latest)) throw new Error(`v${state.latest} failed on this machine before — reinstall it manually`);
  if (!state.assetUrl || !state.shaUrl) throw new Error('this update needs a full reinstall — see the release page');

  const [buf, shaText] = await Promise.all([
    fetchAsset(state.assetUrl, 64 * 1024 * 1024),
    fetchAsset(state.shaUrl, 4096).then((b) => b.toString('utf8')),
  ]);
  const want = (shaText.match(/\b[a-f0-9]{64}\b/i) || [])[0]?.toLowerCase();
  if (!want) throw new Error('release is missing its checksum');
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== want) throw new Error('checksum mismatch — the download was corrupted');

  mkdirSync(paths.updates, { recursive: true });
  const dest = path.join(paths.updates, `bundle-${state.latest}.cjs`);
  writeFileSync(`${dest}.sha256`, got);          // sidecar first: a bundle without
  writeFileSync(`${dest}.tmp`, buf);             // a valid sidecar is never booted
  renameSync(`${dest}.tmp`, dest);
  console.log(`[update] staged v${state.latest} (${(buf.length / 1048576).toFixed(1)} MB).`);
  return state.latest;
}

// ---------- boot-time selection ----------

function isBad(version) {
  return existsSync(path.join(paths.updates, `.bad-${version}`));
}

function shaOk(file) {
  try {
    const want = readFileSync(`${file}.sha256`, 'utf8').trim().toLowerCase();
    return createHash('sha256').update(readFileSync(file)).digest('hex') === want;
  } catch {
    return false;
  }
}

function discard(file) {
  rmSync(file, { force: true });
  rmSync(`${file}.sha256`, { force: true });
}

/** A `.booting` marker left behind means that staged version crashed before
 *  it started serving: mark it bad and remove it so we never retry it. */
function handleCrashMarker() {
  const marker = path.join(paths.updates, '.booting');
  if (!existsSync(marker)) return;
  const version = readFileSync(marker, 'utf8').trim();
  if (version) {
    writeFileSync(path.join(paths.updates, `.bad-${version}`), new Date().toISOString());
    discard(path.join(paths.updates, `bundle-${version}.cjs`));
    console.error(`[update] v${version} crashed on its last start — rolled back to v${APP_VERSION}.`);
  }
  rmSync(marker, { force: true });
}

function pickStaged() {
  if (!existsSync(paths.updates)) return null;
  handleCrashMarker();
  let best = null;
  for (const name of readdirSync(paths.updates)) {
    const m = BUNDLE_RE.exec(name);
    if (!m) continue;
    const file = path.join(paths.updates, name);
    const version = m[1];
    // Obsolete/bad/corrupt ones go; older-but-valid ones stay — they are the
    // fallback if the newest turns out to be broken.
    if (cmpVer(version, APP_VERSION) <= 0 || isBad(version) || !shaOk(file)) { discard(file); continue; }
    if (!best || cmpVer(version, best.version) > 0) best = { version, file };
  }
  return best;
}

/**
 * Called first thing by the packaged entrypoint: if a newer verified bundle is
 * staged, run it instead of the built-in code (it takes over the process and
 * starts its own server). Returns true when it did.
 */
export function loadStagedBundle() {
  if (!process.__followup_sea || process.env.FOLLOWUP_BOOTED) return false;
  process.env.FOLLOWUP_BOOTED = APP_VERSION; // staged copy must not recurse
  let staged;
  while ((staged = pickStaged())) {
    try {
      writeFileSync(path.join(paths.updates, '.booting'), staged.version);
      console.log(`FollowUp: running staged update v${staged.version} (built-in: v${APP_VERSION}).`);
      createRequire(staged.file)(staged.file);
      return true;
    } catch (err) {
      // Mark bad + discard, then try the next-best staged version.
      console.error(`[update] staged v${staged.version} failed to load:`, err.message);
      writeFileSync(path.join(paths.updates, `.bad-${staged.version}`), new Date().toISOString());
      discard(staged.file);
      clearBootMarker();
    }
  }
  return false;
}

/** The server calls this once it is actually listening: boot succeeded. */
export function clearBootMarker() {
  rmSync(path.join(paths.updates, '.booting'), { force: true });
}

// ---------- restart ----------

/** Close the HTTP server, hand the port to a fresh copy of ourselves, exit. */
export function restartSelf(httpServer) {
  console.log('[update] restarting…');
  let done = false;
  const respawn = () => {
    if (done) return;
    done = true;
    try {
      const env = { ...process.env, FOLLOWUP_OPEN: '0' };
      delete env.FOLLOWUP_BOOTED;
      spawn(process.execPath, [], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
    } catch (err) {
      console.error('[update] respawn failed — start FollowUp again by hand:', err.message);
    }
    process.exit(0);
  };
  try { httpServer.close(respawn); } catch { respawn(); }
  setTimeout(respawn, 3000).unref(); // don't hang on a stuck keep-alive socket
}
