import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToken } from '../src/token.js';

/**
 * Package this machine's secrets into an encrypted setup token for a new
 * install (e.g. Madhu's packaged app):
 *
 *   npm run token -- "a passphrase you tell them separately"
 *
 * Writes followup.token (gitignored). Send the file however you like; the
 * passphrase travels by a different channel.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passphrase = process.argv[2];
if (!passphrase || passphrase.length < 6) {
  console.error('Usage: npm run token -- "<passphrase, 6+ chars>"');
  process.exit(1);
}

const envPath = path.join(ROOT, '.env');
if (!existsSync(envPath)) { console.error('.env not found — nothing to package.'); process.exit(1); }
const env = parseEnv(readFileSync(envPath, 'utf8'));
delete env.FOLLOWUP_HOME; // machine-specific, never travels

let coordinatorsLocal = null;
const localPath = path.join(ROOT, 'config', 'coordinators.local.json');
if (existsSync(localPath)) coordinatorsLocal = JSON.parse(readFileSync(localPath, 'utf8'));

const token = createToken({ v: 1, created: new Date().toISOString().slice(0, 10), env, coordinatorsLocal }, passphrase);
const out = path.join(ROOT, 'followup.token');
writeFileSync(out, token + '\n');
console.log(`Wrote ${out}`);
console.log(`Contains: ${Object.keys(env).length} env values${coordinatorsLocal ? ' + coordinators.local.json (emails/phones/scrub names)' : ''}.`);
console.log('Send the FILE one way, the PASSPHRASE another. The recipient uploads it on first launch.');
