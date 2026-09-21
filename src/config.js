import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present (Node 22 built-in; no dotenv dependency).
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* already loaded or malformed line — env vars win */ }
}

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

export const app = loadJson('config/app.json');
export const lodges = loadJson('config/lodges.json');
export const coordinators = loadJson('config/coordinators.json');

// Email addresses, phone numbers, and extra scrub-names live in a gitignored
// local file so they are never committed.
let localEmails = {};
let localPhones = {};
let localScrubNames = [];
try {
  const local = loadJson('config/coordinators.local.json');
  localEmails = local.emails ?? {};
  localPhones = local.phones ?? {};
  localScrubNames = local.scrubNames ?? [];
} catch { /* no local file yet */ }
for (const c of [...coordinators.coordinators, ...(coordinators.extraRecipients ?? [])]) {
  c.email = localEmails[c.name] || '';
}

export function emailFor(name) {
  return localEmails[name] || '';
}

/** WhatsApp number in E.164-ish form, e.g. "+1 931 555 0100" — any format, digits are extracted. */
export function phoneFor(name) {
  return localPhones[name] || '';
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

/** Every name to anonymize before text leaves the machine: config names + local extras. */
export function scrubNameList() {
  return [
    ...coordinators.coordinators.map((c) => c.name),
    ...(coordinators.extraRecipients ?? []).map((c) => c.name),
    ...localScrubNames,
  ];
}

/** Coordinators responsible for a lodge (optionally one floor); falls back to 'overall' coordinators. */
export function lodgeOwnersFor(lodge, floor = null) {
  const owners = coordinators.coordinators
    .filter((c) => assignmentMatches(c.assignedLodges, lodge, floor))
    .map((c) => c.name);
  if (owners.length) return owners;
  return coordinators.coordinators.filter((c) => c.role === 'overall').map((c) => c.name);
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

export const paths = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  db: path.join(ROOT, 'data', 'followup.db'),
  photoCache: path.join(ROOT, 'data', 'photocache'),
  digests: path.join(ROOT, 'data', 'digests'),
};

for (const p of [paths.data, paths.photoCache, paths.digests]) {
  mkdirSync(p, { recursive: true });
}

export function jotformKey() {
  const key = process.env.JOTFORM_API_KEY;
  if (!key) throw new Error('JOTFORM_API_KEY missing — copy .env.example to .env and fill it in.');
  return key;
}

/** All lodge × floor units that contain at least one inspectable wing. */
export function coverageUnits() {
  const units = [];
  for (const lodge of lodges.lodges) {
    for (const [floor, wings] of Object.entries(lodges.floors)) {
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
