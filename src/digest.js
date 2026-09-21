import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { app, coordinators, paths, assignmentMatches, lodges } from './config.js';
import { coverage, openIssues, issueAge } from './queries.js';
import { today, weekStart, fmtDate, fmtWeek } from './util.js';
import { smtpConfigured, sendMail } from './mailer.js';
import { magicUrl } from './links.js';

/**
 * Weekly per-coordinator digest.
 * Default is a DRY RUN: writes HTML files under data/digests/<date>/ so the
 * content can be reviewed. `--send` emails them via the SMTP settings in .env.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CAT_LABEL = { housekeeping: 'Housekeeping', maintenance: 'Maintenance', supplies: 'Supplies', other: 'Other' };
const CAT_ICON = { housekeeping: '🧹', maintenance: '🔧', supplies: '📦', other: '📌' };

function issueRow(i) {
  const age = issueAge(i);
  const ageTxt = age === 0 ? 'today' : `${age}d old`;
  const sev = i.severity === 'high' ? ' ⚠️' : '';
  const rep = i.occurrences > 1 ? ` · seen ${i.occurrences}×` : '';
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #e1e0d9;white-space:nowrap;">${esc(i.area)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e1e0d9;">${esc(i.description)}${sev}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e1e0d9;white-space:nowrap;color:#52514e;">${CAT_ICON[i.category] || CAT_ICON.other} ${CAT_LABEL[i.category] || i.category}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e1e0d9;white-space:nowrap;color:${age >= 14 ? '#d03b3b' : '#52514e'};">${ageTxt}${rep}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e1e0d9;white-space:nowrap;"><a href="${magicUrl(i.id)}" style="color:#2a78d6;font-weight:600;text-decoration:none;">✓ done?</a></td>
  </tr>`;
}

function issueGroup(label, list, color) {
  if (!list.length) return '';
  return `<p style="margin:10px 0 4px;font-size:13px;font-weight:600;color:${color};">${esc(label)} (${list.length})</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">${list.map(issueRow).join('')}</table>`;
}

function lodgeSection(lodge, issues, newSince) {
  const fresh = issues.filter((i) => i.first_seen >= newSince);
  const ongoing = issues.filter((i) => i.first_seen < newSince);
  return `<h3 style="margin:22px 0 2px;font-size:16px;">${lodges.icons?.[lodge] ?? ''} ${esc(lodge)} — ${issues.length} open</h3>
    ${issueGroup('New this week', fresh, '#0b0b0b')}
    ${issueGroup('Ongoing', ongoing, '#52514e')}`;
}

export function buildDigest(coordinator) {
  const date = today();
  const wkStart = weekStart(date);
  const scope = coordinator.assignedLodges?.length ? coordinator.assignedLodges : null;

  let issues = openIssues({});
  if (scope) issues = issues.filter((i) => assignmentMatches(scope, i.lodge, i.floor));

  const cov = coverage(2);
  const covRows = cov.units
    .filter((u) => !scope || assignmentMatches(scope, u.lodge, u.floor))
    .map((u) => {
      const thisWk = u.cells[u.cells.length - 1].walks;
      const status = thisWk.length
        ? `✓ walked ${thisWk.map((w) => `${esc(w.coordinator)} (${fmtDate(w.walk_date)})`).join(', ')}`
        : u.staleDays == null
          ? '✗ never walked'
          : `✗ not yet this week — last ${fmtDate(u.lastWalked)} (${u.staleDays}d ago)`;
      const color = thisWk.length ? '#006300' : '#d03b3b';
      return `<tr><td style="padding:4px 10px;white-space:nowrap;">${esc(u.lodge)} · ${esc(u.floor)}</td>
        <td style="padding:4px 10px;color:${color};">${status}</td></tr>`;
    }).join('');

  const byLodge = {};
  for (const i of issues) (byLodge[i.lodge] ??= []).push(i);

  const high = issues.filter((i) => i.severity === 'high');
  const fresh = issues.filter((i) => i.first_seen >= wkStart);
  const ongoing = issues.filter((i) => i.first_seen < wkStart);

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b;background:#fcfcfb;margin:0;padding:24px;">
  <div style="max-width:680px;margin:0 auto;">
    <h1 style="font-size:20px;margin:0 0 2px;"><span style="color:#1c4586;">Follow</span><span style="color:#8e7cc3;">Up</span> — week of ${fmtWeek(wkStart)}</h1>
    <div style="width:56px;height:3px;background:#ffa74c;border-radius:2px;margin:8px 0 12px;"></div>
    <p style="color:#52514e;margin:0 0 18px;">Hi ${esc(coordinator.name)} — here's the lodge ambiance picture as of ${fmtDate(date)}.</p>

    <table style="border-collapse:collapse;margin:0 0 18px;">
      <tr>
        <td style="padding:10px 18px 10px 0;"><div style="font-size:26px;font-weight:600;">${issues.length}</div><div style="font-size:12px;color:#52514e;">open issues${scope ? ' (your lodges)' : ''}</div></td>
        <td style="padding:10px 18px;"><div style="font-size:26px;font-weight:600;color:${high.length ? '#d03b3b' : '#0b0b0b'};">${high.length}</div><div style="font-size:12px;color:#52514e;">high priority</div></td>
        <td style="padding:10px 18px;"><div style="font-size:26px;font-weight:600;">${fresh.length}</div><div style="font-size:12px;color:#52514e;">new this week</div></td>
        <td style="padding:10px 18px;"><div style="font-size:26px;font-weight:600;">${ongoing.length}</div><div style="font-size:12px;color:#52514e;">ongoing</div></td>
      </tr>
    </table>

    <h2 style="font-size:17px;margin:22px 0 6px;">Walkthrough coverage this week</h2>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">${covRows}</table>

    <h2 style="font-size:17px;margin:22px 0 0;">Open issues by lodge</h2>
    ${Object.entries(byLodge).map(([lodge, list]) => lodgeSection(lodge, list, wkStart)).join('') || '<p>Nothing open. 🎉</p>'}

    <p style="color:#898781;font-size:12px;margin-top:26px;">Sent by FollowUp (runs on-campus). Reply to the overall coordinator with corrections.
    Tap “✓ done?” next to an item once it's handled — it drops off next week's list.</p>
  </div></body></html>`;

  const textIssue = (i) => `    - [${i.area}] ${i.description} (${i.category}, open ${issueAge(i)}d)`;
  const textLines = [
    `FollowUp — week of ${fmtWeek(wkStart)}`,
    `${issues.length} open issues: ${fresh.length} new this week, ${ongoing.length} ongoing, ${high.length} high priority`,
    '',
    ...Object.entries(byLodge).flatMap(([lodge, list]) => {
      const f = list.filter((i) => i.first_seen >= wkStart);
      const o = list.filter((i) => i.first_seen < wkStart);
      return [
        `${lodge}:`,
        ...(f.length ? [`  New this week (${f.length}):`, ...f.map(textIssue)] : []),
        ...(o.length ? [`  Ongoing (${o.length}):`, ...o.map(textIssue)] : []),
        '',
      ];
    }),
  ];

  return { html, text: textLines.join('\n'), subject: `FollowUp digest — week of ${fmtWeek(wkStart)}` };
}

export async function runDigest({ send = false } = {}) {
  const outDir = path.join(paths.digests, today());
  mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const c of coordinators.coordinators) {
    if (c.digest === false) continue;
    const digest = buildDigest(c);
    const file = path.join(outDir, `${c.name.toLowerCase()}.html`);
    writeFileSync(file, digest.html);
    let sent = false;
    if (send && c.email) {
      if (!smtpConfigured()) throw new Error('SMTP not configured in .env — run without --send to preview.');
      await sendMail({ to: c.email, subject: digest.subject, html: digest.html, text: digest.text });
      sent = true;
    }
    results.push({ name: c.name, email: c.email, file, sent });
  }
  return { outDir, results };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const send = process.argv.includes('--send');
  runDigest({ send })
    .then(({ outDir, results }) => {
      for (const r of results) {
        console.log(`${r.sent ? 'SENT  ' : 'DRAFT '} ${r.name.padEnd(8)} ${r.sent ? '→ ' + r.email : r.file}`);
      }
      if (!send) console.log(`\nDry run only — review the HTML in ${outDir}, then use \`npm run digest:send\`.`);
    })
    .catch((err) => { console.error('Digest failed:', err.message); process.exit(1); });
}
