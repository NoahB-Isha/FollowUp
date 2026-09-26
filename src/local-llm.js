import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Managed local model server: a llama.cpp `llama-server` we ship inside the
 * packaged app (resources/llama/* + resources/model.gguf) and spawn on
 * demand. Nothing to install, nothing leaves the machine. In a dev checkout
 * point FOLLOWUP_RESOURCES at a folder with the same layout to test.
 */

const PORT = Number(process.env.FOLLOWUP_LLM_PORT || 11540);

function resourcesDir() {
  if (process.env.FOLLOWUP_RESOURCES) return path.resolve(process.env.FOLLOWUP_RESOURCES);
  if (!process.__followup_sea) return null;
  const exeDir = path.dirname(process.execPath);
  // macOS .app bundle: Contents/MacOS/<exe> → Contents/Resources
  for (const c of [path.join(exeDir, '..', 'Resources'), path.join(exeDir, 'resources')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function serverBin(res) {
  const bin = path.join(res, 'llama', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  return existsSync(bin) ? bin : null;
}

function modelPath(res) {
  const m = path.join(res, 'model.gguf');
  return existsSync(m) ? m : null;
}

export function localAvailable() {
  const res = resourcesDir();
  return !!(res && serverBin(res) && modelPath(res));
}

export function localModelName() {
  return 'qwen3-4b';
}

let child = null;
let starting = null;

async function healthy() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/** Spawn (once) and wait until the model answers /health. Returns the base URL. */
export async function ensureLocalServer() {
  const url = `http://127.0.0.1:${PORT}`;
  if (await healthy()) return url; // ours from earlier, or an orphan from a crash — reuse either way
  if (starting) { await starting; return url; }

  const res = resourcesDir();
  const bin = res && serverBin(res);
  const model = res && modelPath(res);
  if (!bin || !model) throw new Error('local model resources not found');

  starting = (async () => {
    child = spawn(bin, [
      '-m', model,
      '--port', String(PORT), '--host', '127.0.0.1',
      '--jinja', '--reasoning', 'off',
      '-c', '8192', '-ngl', '99',
    ], { cwd: path.dirname(bin), stdio: 'ignore' });
    child.unref(); // never hold the event loop open — CLIs must exit when done
    child.on('exit', () => { child = null; });
    const kill = () => { try { child?.kill(); } catch { /* already gone */ } };
    process.once('exit', kill);
    process.once('SIGINT', () => { kill(); process.exit(0); });
    process.once('SIGTERM', () => { kill(); process.exit(0); });

    const deadline = Date.now() + 120_000; // first start loads ~2.5 GB into memory
    while (Date.now() < deadline) {
      if (await healthy()) return;
      if (!child) throw new Error('llama-server exited during startup');
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error('llama-server did not become healthy in 120s');
  })();
  try { await starting; } finally { starting = null; }
  return url;
}
