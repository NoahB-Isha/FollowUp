import { copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { app, paths, isConfigured } from './config.js';
import { getMeta, setMeta } from './db.js';
import { sync } from './sync.js';
import { runDigest } from './digest.js';
import { smtpConfigured } from './mailer.js';
import { today, weekStart } from './util.js';

/**
 * In-app scheduler — replaces cron so the packaged app is self-sufficient.
 *  - sync every `syncIntervalHours` (default 6; app.json)
 *  - digest email Monday 07:00+ (only when SMTP is configured; once per week)
 *  - DB backup once a day, keeping the last 14
 * Everything no-ops until setup is complete, and failures never crash the app.
 */

let running = false;

async function tick() {
  if (running || !isConfigured()) return;
  running = true;
  try {
    await maybeSync();
    await maybeDigest();
    maybeBackup();
  } catch (err) {
    console.error('[scheduler]', err.message);
  } finally {
    running = false;
  }
}

async function maybeSync() {
  const hours = Number(app.syncIntervalHours ?? 6);
  const last = Number(getMeta('last_auto_sync') ?? 0);
  if (Date.now() - last < hours * 3600_000) return;
  setMeta('last_auto_sync', String(Date.now()));
  const r = await sync();
  if (r.added) console.log(`[scheduler] sync: ${r.added} new walkthroughs, ${r.issuesNew} new issues (${r.extractor}).`);
}

async function maybeDigest() {
  if (!smtpConfigured()) return;
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() < 7) return; // Monday, from 07:00
  const thisWeek = weekStart(today());
  if (getMeta('last_digest_week') === thisWeek) return;
  setMeta('last_digest_week', thisWeek);
  const { results } = await runDigest({ send: true });
  console.log(`[scheduler] digest sent to ${results.filter((r) => r.sent).length} coordinator(s).`);
}

function maybeBackup() {
  const stamp = today();
  if (getMeta('last_backup_date') === stamp) return;
  copyFileSync(paths.db, path.join(paths.backups, `followup-${stamp}.db`));
  setMeta('last_backup_date', stamp);
  const old = readdirSync(paths.backups).filter((f) => f.endsWith('.db')).sort().slice(0, -14);
  for (const f of old) unlinkSync(path.join(paths.backups, f));
}

export function startScheduler() {
  setTimeout(tick, 15_000);            // first pass shortly after boot
  setInterval(tick, 10 * 60_000);      // then check every 10 minutes
}

/** Called right after setup completes: pull data immediately. */
export async function kickoffInitialSync() {
  try {
    const r = await sync();
    console.log(`[setup] initial sync: ${r.added} walkthroughs, ${r.issuesNew} issues (${r.extractor}).`);
    return r;
  } catch (err) {
    console.error('[setup] initial sync failed:', err.message);
    return null;
  }
}
