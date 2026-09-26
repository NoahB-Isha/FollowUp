import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync, chmodSync, readdirSync, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Desktop packaging: a self-contained app with the local model INSIDE —
 * end users install one thing and never see a terminal, an Ollama, or a
 * model download.
 *
 *   npm run build:desktop            → macOS arm64 + Intel DMGs, Windows zip
 *   npm run build:desktop -- --host  → just this Mac's arch (for testing)
 *
 * Contents per app: the SEA server binary (built by scripts/build.mjs),
 * llama.cpp's llama-server + libs, and Qwen3-4B GGUF (~2.4 GB — the model is
 * most of the artifact). macOS ships as a real .app in a DMG; Windows as a
 * portable folder zip with a hidden-console launcher (NSIS installers cap at
 * 2 GB, below the model's size).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.build-cache');
const DIST = path.join(ROOT, 'dist');
const HOST_ONLY = process.argv.includes('--host');

const LLAMA_TAG = 'b11146';
const MODEL_URL = 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf';
const MODEL = path.join(CACHE, 'qwen3-4b-q4.gguf');
const ICON = path.join(CACHE, 'app.icns');

mkdirSync(DIST, { recursive: true });

async function download(url, dest) {
  if (existsSync(dest)) return;
  console.log(`fetching ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

// ---------- shared inputs ----------
if (!existsSync(MODEL) || statSync(MODEL).size < 2_000_000_000) {
  await download(MODEL_URL, MODEL);
}
const seaTargets = HOST_ONLY ? ['--host'] : [];
run(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), ...seaTargets]); // ensures dist/<target>-FollowUp SEA binaries

function llamaDir(archive, innerMatch) {
  const marker = path.join(CACHE, `${archive}.dir`);
  if (!existsSync(marker)) {
    const archivePath = path.join(CACHE, archive);
    if (archive.endsWith('.zip')) run('unzip', ['-o', '-q', archivePath, '-d', marker]);
    else { mkdirSync(marker, { recursive: true }); run('tar', ['-xzf', archivePath, '-C', marker]); }
  }
  // find the dir that contains llama-server(.exe)
  const stack = [marker];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (e.name === innerMatch) return d;
    }
  }
  throw new Error(`llama-server not found in ${archive}`);
}

function copyLlama(srcDir, destDir, exe) {
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f === exe || f.endsWith('.dylib') || f.endsWith('.dll') || f.endsWith('.so')) {
      copyFileSync(path.join(srcDir, f), path.join(destDir, f));
      chmodSync(path.join(destDir, f), 0o755);
    }
  }
}

// ---------- macOS .app + DMG ----------
async function buildMac(arch) {
  const archive = `llama-${LLAMA_TAG}-bin-macos-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`;
  await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${archive}`, path.join(CACHE, archive));
  const llamaSrc = llamaDir(archive, 'llama-server');

  const seaName = arch === 'arm64' ? 'macos-arm64-FollowUp' : 'macos-intel-FollowUp';
  const sea = path.join(DIST, seaName);
  if (!existsSync(sea)) throw new Error(`missing SEA binary ${seaName} — run npm run build first`);

  const stage = path.join(CACHE, `desktop-mac-${arch}`);
  rmSync(stage, { recursive: true, force: true });
  const app = path.join(stage, 'FollowUp.app');
  const contents = path.join(app, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  mkdirSync(path.join(contents, 'Resources'), { recursive: true });

  writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>FollowUp</string>
  <key>CFBundleDisplayName</key><string>FollowUp</string>
  <key>CFBundleIdentifier</key><string>org.ishausa.followup</string>
  <key>CFBundleVersion</key><string>0.3.0</string>
  <key>CFBundleShortVersionString</key><string>0.3.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>FollowUp</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><true/>
</dict></plist>`);

  copyFileSync(sea, path.join(contents, 'MacOS', 'FollowUp'));
  chmodSync(path.join(contents, 'MacOS', 'FollowUp'), 0o755);
  if (existsSync(ICON)) copyFileSync(ICON, path.join(contents, 'Resources', 'app.icns'));
  copyLlama(llamaSrc, path.join(contents, 'Resources', 'llama'), 'llama-server');
  copyFileSync(MODEL, path.join(contents, 'Resources', 'model.gguf'));

  // ad-hoc sign everything (Gatekeeper still requires right-click → Open once)
  for (const f of readdirSync(path.join(contents, 'Resources', 'llama'))) {
    execFileSync('codesign', ['--force', '-s', '-', path.join(contents, 'Resources', 'llama', f)]);
  }
  execFileSync('codesign', ['--force', '-s', '-', path.join(contents, 'MacOS', 'FollowUp')]);
  execFileSync('codesign', ['--force', '-s', '-', app]);

  const dmg = path.join(DIST, `FollowUp-desktop-macos-${arch === 'arm64' ? 'apple-silicon' : 'intel'}.dmg`);
  rmSync(dmg, { force: true });
  run('hdiutil', ['create', '-volname', 'FollowUp', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', dmg]);
  console.log(`✓ ${path.relative(ROOT, dmg)} (${(statSync(dmg).size / 1048576 / 1024).toFixed(2)} GB)`);
}

// ---------- Windows portable zip ----------
async function buildWindows() {
  const archive = `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`;
  await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${archive}`, path.join(CACHE, archive));
  const llamaSrc = llamaDir(archive, 'llama-server.exe');

  const sea = path.join(DIST, 'windows-x64-FollowUp.exe');
  if (!existsSync(sea)) throw new Error('missing windows SEA binary — run npm run build first');

  const stage = path.join(CACHE, 'desktop-win');
  rmSync(stage, { recursive: true, force: true });
  const appdir = path.join(stage, 'FollowUp');
  mkdirSync(path.join(appdir, 'resources'), { recursive: true });
  copyFileSync(sea, path.join(appdir, 'FollowUp-server.exe'));
  copyLlama(llamaSrc, path.join(appdir, 'resources', 'llama'), 'llama-server.exe');
  copyFileSync(MODEL, path.join(appdir, 'resources', 'model.gguf'));

  // Double-clickable launcher that hides the console window.
  writeFileSync(path.join(appdir, 'FollowUp.vbs'),
`Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & sh.CurrentDirectory & "\\FollowUp-server.exe""", 0, False
`);
  writeFileSync(path.join(appdir, 'README.txt'),
`FollowUp for Windows (portable)
==============================
1. Keep this whole folder together (e.g. move it to Documents).
2. Double-click FollowUp.vbs — your browser opens the dashboard.
   (SmartScreen may object the first time: More info → Run anyway.)
3. First launch: upload the setup token you were sent.
Data lives in %USERPROFILE%\\FollowUp. To stop FollowUp, end
"FollowUp-server.exe" in Task Manager or restart the computer.
`);
  const zip = path.join(DIST, 'FollowUp-desktop-windows-x64.zip');
  rmSync(zip, { force: true });
  run('zip', ['-9', '-r', '-q', zip, 'FollowUp'], { cwd: stage });
  console.log(`✓ ${path.relative(ROOT, zip)} (${(statSync(zip).size / 1048576 / 1024).toFixed(2)} GB)`);
}

const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64';
if (HOST_ONLY) {
  await buildMac(hostArch);
} else {
  await buildMac('arm64');
  await buildMac('x64');
  await buildWindows();
}
console.log('desktop builds done.');
