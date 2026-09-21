import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import defaultApp from '../config/app.json' with { type: 'json' };
import defaultLodges from '../config/lodges.json' with { type: 'json' };
import defaultCoordinators from '../config/coordinators.json' with { type: 'json' };

/**
 * Configuration, HOME-aware and reloadable.
 *
 * Dev checkout: HOME is the repo root — config/, data/, .env live where they
 * always have. Packaged app (Node SEA binary): HOME is ~/FollowUp (override
 * with FOLLOWUP_HOME), created on first run with the default config files
 * written out for editing. reloadConfig() re-reads everything in place, so
 * the setup page can apply an uploaded token without a restart.
 */

function isPackaged() {
  try { return process.__followup_sea ?? false; } catch { return false; }
}

const REPO_ROOT = (() => {
  try { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); }
  catch { return process.cwd(); }
})();

export const HOME = process.env.FOLLOWUP_HOME
  ? path.resolve(process.env.FOLLOWUP_HOME)
  : isPackaged() ? path.join(os.homedir(), 'FollowUp') : REPO_ROOT;

const IS_HOME_MODE = HOME !== REPO_ROOT;

export const paths = {
  root: HOME,
  configDir: path.join(HOME, 'config'),
  env: path.join(HOME, '.env'),
  data: path.join(HOME, 'data'),
  db: path.join(HOME, 'data', 'followup.db'),
  photoCache: path.join(HOME, 'data', 'photocache'),
  digests: path.join(HOME, 'data', 'digests'),
  backups: path.join(HOME, 'data', 'backups'),
  avatars: IS_HOME_MODE ? path.join(HOME, 'avatars') : path.join(REPO_ROOT, 'src', 'web', 'avatars'),
};

for (const p of [paths.configDir, paths.data, paths.photoCache, paths.digests, paths.backups, paths.avatars]) {
  mkdirSync(p, { recursive: true });
}

// First run in HOME mode: write editable default configs.
const DEFAULTS = { 'app.json': defaultApp, 'lodges.json': defaultLodges, 'coordinators.json': defaultCoordinators };
for (const [file, content] of Object.entries(DEFAULTS)) {
  const target = path.join(paths.configDir, file);
  if (!existsSync(target)) writeFileSync(target, JSON.stringify(content, null, 2));
}

/** Recursively mirror src into target without replacing object/array references. */
function assignInPlace(target, src) {
  if (Array.isArray(target)) {
    target.length = 0;
    for (const v of src) target.push(v);
    return;
  }
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object') {
      const sameShape = target[k] && typeof target[k] === 'object'
        && Array.isArray(target[k]) === Array.isArray(v);
      if (!sameShape) target[k] = Array.isArray(v) ? [] : {};
      assignInPlace(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

export const app = {};
export const lodges = {};
export const coordinators = {};

let localEmails = {};
let localPhones = {};
let localScrubNames = [];

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(path.join(paths.configDir, file), 'utf8')); }
  catch { return fallback; }
}

export function reloadConfig() {
  // .env — packaged setups write it via the token upload; values override.
  if (existsSync(paths.env)) {
    try {
      for (const [k, v] of Object.entries(parseEnv(readFileSync(paths.env, 'utf8')))) process.env[k] = v;
    } catch { /* malformed line — env vars already set still apply */ }
  }

  assignInPlace(app, readJson('app.json', defaultApp));
  assignInPlace(lodges, readJson('lodges.json', defaultLodges));
  assignInPlace(coordinators, readJson('coordinators.json', defaultCoordinators));

  const local = readJson('coordinators.local.json', {});
  localEmails = local.emails ?? {};
  localPhones = local.phones ?? {};
  localScrubNames = local.scrubNames ?? [];
  for (const c of [...(coordinators.coordinators ?? []), ...(coordinators.extraRecipients ?? [])]) {
    c.email = localEmails[c.name] || '';
  }
}

reloadConfig();

export function jotformKey() {
  const key = process.env.JOTFORM_API_KEY;
  if (!key) throw new Error('JOTFORM_API_KEY missing — complete setup (or fill .env).');
  return key;
}

export function isConfigured() {
  return !!process.env.JOTFORM_API_KEY;
}

export function emailFor(name) {
  return localEmails[name] || '';
}

/** WhatsApp number in E.164-ish form, e.g. "+1 931 555 0100" — any format, digits are extracted. */
export function phoneFor(name) {
  return localPhones[name] || '';
}

/** Every name to anonymize before text leaves the machine: config names + local extras. */
export function scrubNameList() {
  return [
    ...(coordinators.coordinators ?? []).map((c) => c.name),
    ...(coordinators.extraRecipients ?? []).map((c) => c.name),
    ...localScrubNames,
  ];
}

/**
 * Does an assignment list cover this lodge (and floor, if given)?
 * Entries are "Lodge" (whole building) or "Lodge:Floor" (one floor).
 * With no floor argument, any assignment on the lodge matches.
 */
export function assignmentMatches(assignments, lodge, floor = null) {
  return (assignments || []).some((a) => {
    const [l, f] = a.split(':');
    return l === lodge && (!f || !floor || f === floor);
  });
}

/** Coordinators responsible for a lodge (optionally one floor); falls back to 'overall' coordinators. */
export function lodgeOwnersFor(lodge, floor = null) {
  const owners = (coordinators.coordinators ?? [])
    .filter((c) => assignmentMatches(c.assignedLodges, lodge, floor))
    .map((c) => c.name);
  if (owners.length) return owners;
  return (coordinators.coordinators ?? []).filter((c) => c.role === 'overall').map((c) => c.name);
}

/**
 * Contact list for a task: that floor's coordinators plus the department
 * coordinators for the issue's category. Responsibility comes entirely from
 * config — issues are never individually assigned.
 */
export function contactsForIssue(issue) {
  const list = [...lodgeOwnersFor(issue.lodge, issue.floor)];
  for (const n of coordinators.departments?.[issue.category] ?? []) list.push(n);
  return [...new Set(list)];
}

/** All lodge × floor units that contain at least one inspectable wing. */
export function coverageUnits() {
  const units = [];
  for (const lodge of lodges.lodges ?? []) {
    for (const [floor, wings] of Object.entries(lodges.floors ?? {})) {
      const inspectable = wings.filter((w) => wingInfo(lodge, w).inspect);
      if (inspectable.length) units.push({ lodge, floor, wings: inspectable });
    }
  }
  return units;
}

export function wingInfo(lodge, wing) {
  const o = lodges.wingOverrides?.[lodge]?.[wing];
  return { use: o?.use ?? 'Dorm', inspect: o?.inspect ?? true };
}
