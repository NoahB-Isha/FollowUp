import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './layout.js';
import { coordinators, phoneFor, contactsForIssue, lodgeOwnersFor, lodges as lodgesCfg } from '../config.js';
import { issueAge } from '../queries.js';
import { magicUrl } from '../links.js';
import { fmtDate, fmtWeek, today, weekStart } from '../util.js';

const AVATAR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'avatars');

const CAT_LABEL = { housekeeping: 'Housekeeping', maintenance: 'Maintenance', supplies: 'Supplies', other: 'Other' };
const CAT_ICON = { housekeeping: '🧹', maintenance: '🔧', supplies: '📦', other: '📌' };
const CATEGORIES = Object.keys(CAT_LABEL);

function catBadge(category) {
  return `${CAT_ICON[category] || CAT_ICON.other} ${CAT_LABEL[category] || esc(category)}`;
}

function floorLabel(floor) {
  return floor === 'First' ? 'First floor' : floor === 'Second' ? 'Second floor' : `${floor} floor`;
}

// Dorm icons — Lucide (ISC), inlined so nothing loads externally.
// Emoji (lodges.json "icons") are still used in digest emails, where inline SVG gets stripped.
const DORM_SVG = {
  Hickory: `<path d="M12 4V2"/><path d="M5 10v4a7.004 7.004 0 0 0 5.277 6.787c.412.104.802.292 1.102.592L12 22l.621-.621c.3-.3.69-.488 1.102-.592A7.003 7.003 0 0 0 19 14v-4"/><path d="M12 4C8 4 4.5 6 4 8c-.243.97-.919 1.952-2 3 1.31-.082 1.972-.29 3-1 .54.92.982 1.356 2 2 1.452-.647 1.954-1.098 2.5-2 .595.995 1.151 1.427 2.5 2 1.31-.621 1.862-1.058 2.5-2 .629.977 1.162 1.423 2.5 2 1.209-.548 1.68-.967 2-2 1.032.916 1.683 1.157 3 1-1.297-1.036-1.758-2.03-2-3-.5-2-4-4-8-4Z"/>`, // nut
  Maple: `<path d="M11 20a10 10 0 0 0 10-10 25.9 25.9 0 0 0-1.04-7.281 1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/>`, // leaf
  Magnolia: `<circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/>`, // flower
  Poplar: `<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>`, // trees
};
const DORM_FALLBACK_SVG = `<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>`;

function dormIcon(lodge, size = 26) {
  const color = lodgesCfg.colors?.[lodge] ?? 'currentColor';
  return `<svg class="dorm-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${DORM_SVG[lodge] ?? DORM_FALLBACK_SVG}</svg>`;
}

// Profile bubbles: a real photo dropped into src/web/avatars/<Name>.jpg|png
// wins; otherwise a deterministic colored-initials circle.
const AVATAR_HUES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

function avatar(name, cls = '') {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    if (existsSync(path.join(AVATAR_DIR, `${name}.${ext}`))) {
      return `<img class="avatar ${cls}" src="/avatars/${encodeURIComponent(name)}.${ext}" alt="">`;
    }
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = AVATAR_HUES[h % AVATAR_HUES.length];
  return `<span class="avatar ${cls}" style="background:color-mix(in srgb, ${c} 22%, var(--surface));color:${c}">${esc(name.slice(0, 2))}</span>`;
}

function whereLabel(i) {
  return `<b>${esc(i.lodge)}</b> · ${esc(floorLabel(i.floor))} · ${esc(i.area)}`;
}

/** WhatsApp deep link. With no number on file it still opens WhatsApp with the message ready — the sender picks the chat. */
function waHref(name, text) {
  const digits = (phoneFor(name) || '').replace(/\D/g, '');
  const t = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${t}` : `https://wa.me/?text=${t}`;
}

function issueMessage(i) {
  const age = issueAge(i);
  return [
    `${i.lodge} ${floorLabel(i.floor)} — ${i.area}`,
    `Issue: ${i.description}`,
    `Type: ${CAT_LABEL[i.category] || i.category}${i.severity === 'high' ? ' (HIGH priority)' : ''}`,
    `Open for ${age} day${age === 1 ? '' : 's'} — first seen ${i.first_seen}, reported ${i.occurrences}×`,
    '',
    `When it’s handled, tap here to check it off: ${magicUrl(i.id)}`,
    'Thank you! 🙏',
  ].join('\n');
}

const SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>`;

function waTitle(name) {
  return phoneFor(name)
    ? `WhatsApp ${esc(name)}`
    : `No number on file for ${esc(name)} — WhatsApp opens with the message ready; pick their chat`;
}

/**
 * The hero action: one big Follow up button. A single responsible contact
 * links straight to their WhatsApp; several expand into per-person links.
 */
function followUpButton(contacts, msg, { size = '' } = {}) {
  // ✳ marks contacts with no WhatsApp number on file (config/coordinators.local.json):
  // the link still opens WhatsApp with the message ready, but can't pick the chat itself.
  if (contacts.length <= 1) {
    const name = contacts[0] || '';
    return `<a class="btn-followup ${size}" target="_blank" rel="noreferrer" href="${waHref(name, msg)}" title="${waTitle(name)}">${SEND_ICON} Follow up${phoneFor(name) ? '' : '<sup class="nonum">✳</sup>'}</a>`;
  }
  const links = contacts.map((name) =>
    `<a class="${phoneFor(name) ? '' : 'nonum'}" target="_blank" rel="noreferrer" href="${waHref(name, msg)}" title="${waTitle(name)}">💬 ${esc(name)}${phoneFor(name) ? '' : '<sup class="nonum">✳</sup>'}</a>`).join('');
  return `<details class="fu">
    <summary title="Follow up via WhatsApp — ${contacts.map(esc).join(', ')}">${SEND_ICON} Follow up <span class="caret">▾</span></summary>
    <div class="fu-menu">${links}</div>
  </details>`;
}

function ageText(i) {
  const age = issueAge(i);
  const t = age === 0 ? 'opened today' : `open for ${age} day${age === 1 ? '' : 's'}`;
  return `<span class="age ${age >= 14 ? 'old' : ''}">${t}</span>`;
}

function chips(issue) {
  const out = [`<span class="chip cat-${esc(issue.category)}">${catBadge(issue.category)}</span>`];
  if (issue.severity === 'high') out.push(`<span class="chip sev-high">⚠ high</span>`);
  out.push(`<span class="chip ${issueAge(issue) >= 14 ? 'age-old' : ''}">${issueAge(issue)}d open</span>`);
  if (issue.occurrences > 1) out.push(`<span class="chip recur">seen ${issue.occurrences}×</span>`);
  return out.join(' ');
}

function resolveForms(i) {
  return `
    <form class="inline" method="post" action="/issues/${i.id}/status">
      <input type="hidden" name="status" value="resolved"><button title="Mark resolved">✓ Resolve</button>
    </form>`;
}

function issueActions(issue) {
  return `
    ${followUpButton(contactsForIssue(issue), issueMessage(issue))}
    ${resolveForms(issue)}
    <form class="inline" method="post" action="/issues/${issue.id}/status">
      <input type="hidden" name="status" value="dismissed"><button title="Not actionable / duplicate">✕</button>
    </form>`;
}

/** Full-featured table used on the Issues page, lodge pages, and walkthrough detail. */
export function issuesTable(issues, { areaOnly = false } = {}) {
  if (!issues.length) return `<div class="empty">No open issues match.</div>`;
  return `<table class="data">
    <tr><th>Where</th><th>Issue</th><th></th><th>First seen</th><th>Contact / act</th></tr>
    ${issues.map((i) => `<tr>
      <td class="where">${areaOnly ? `<b>${esc(i.area)}</b>` : whereLabel(i)}</td>
      <td class="desc"><a href="/issue/${i.id}" title="History & similar issues">${esc(i.description)}</a></td>
      <td class="chips">${chips(i)}</td>
      <td class="num">${fmtDate(i.first_seen)}</td>
      <td><div class="actions">${issueActions(i)}</div></td>
    </tr>`).join('')}
  </table>`;
}

/** Descriptive issue list for the overview: where, what, type + age, follow up / resolve. */
export function longestOpenTable(issues, { emptyMsg = 'Nothing open. 🎉' } = {}) {
  if (!issues.length) return `<div class="empty">${emptyMsg}</div>`;
  return `<table class="data">
    <tr><th>Where</th><th>Issue</th><th>Type &amp; age</th><th>Act</th></tr>
    ${issues.map((i) => `<tr>
      <td class="where">${whereLabel(i)}</td>
      <td class="desc"><a href="/issue/${i.id}" title="History & similar issues">${esc(i.description)}</a>${i.occurrences > 1 ? ` <span class="muted">(reported ${i.occurrences}×)</span>` : ''}</td>
      <td class="nowrap">${catBadge(i.category)}${i.severity === 'high' ? ' <span class="chip sev-high">⚠ high</span>' : ''}<br>${ageText(i)}</td>
      <td><div class="actions">
        ${followUpButton(contactsForIssue(i), issueMessage(i))}
        ${resolveForms(i)}
      </div></td>
    </tr>`).join('')}
  </table>`;
}

function lodgeCard(h) {
  const owners = lodgeOwnersFor(h.lodge).join(', ');
  const floorLine = (f) => {
    const date = f.lastWalked
      ? `${fmtDate(f.lastWalked)}${f.staleDays > 10 ? ' ⚠' : ''}`
      : '<span class="status-miss">never</span>';
    return `<div class="lc-floor">${f.floor === 'First' ? '1st' : '2nd'} Floor: <b>${date}</b></div>`;
  };
  return `<a class="lodgecard" href="/lodges/${encodeURIComponent(h.lodge)}">
    <div class="lc-top"><span class="lc-name">${dormIcon(h.lodge, 30)} ${esc(h.lodge)}</span></div>
    <div class="lc-contacts" title="Contacts: ${esc(owners)}">Contacts: ${esc(owners) || '—'}</div>
    <div class="lc-nums">${h.open} Open Issue${h.open === 1 ? '' : 's'}${h.high ? ` · <b class="bad">${h.high} High Priority</b>` : ''}</div>
    <div class="lc-sub">Last Walkthrough</div>
    ${h.floors.map(floorLine).join('')}
  </a>`;
}

function responsibilityLabel(c) {
  if (c.role === 'overall') return 'All lodges (overall)';
  const parts = (c.assignedLodges || []).map((a) => {
    const [lodge, floor] = a.split(':');
    return floor ? `${lodge} (${floor === 'First' ? '1st' : '2nd'} floor)` : lodge;
  });
  return parts.join(', ') || '—';
}

/** "This week" as a row of coordinator bubbles: done in color, not-done greyed with a Follow up. */
function coordBubbles(weekly) {
  const bubbles = coordinators.coordinators.map((c) => {
    const walks = weekly.byCoord.get(c.name) || [];
    const done = walks.length > 0;
    const scope = c.role === 'overall' ? '' : responsibilityLabel(c).replace('—', '');
    const reminder = `Hi ${c.name} — friendly reminder to complete your lodge walkthrough${scope ? ` for ${scope}` : ''} this week (${fmtWeek(weekly.weekStart)}) and submit the checklist form. Thank you! 🙏`;
    const status = done
      ? walks.map((w) => `<a href="/walkthroughs/${esc(w.id)}" title="${esc(fmtDate(w.walk_date))}">✓ ${esc(w.lodge)} ${w.floor === 'First' ? '1st' : '2nd'}</a>`).join('<br>')
      : 'Not done';
    return `<div class="coord ${done ? 'done' : 'notdone'}" title="${esc(c.name)} — ${esc(responsibilityLabel(c))}">
      ${avatar(c.name)}
      <div class="coord-name">${esc(c.name)}</div>
      <div class="coord-status">${status}</div>
      ${done ? '' : followUpButton([c.name], reminder, { size: 'sm' })}
    </div>`;
  }).join('');
  return `<div class="coords">${bubbles}</div>`;
}

export function coverageGrid(cov) {
  const currentWeek = weekStart(today());
  const head = cov.weekStarts.map((ws) =>
    `<th title="Week of ${esc(fmtWeek(ws))}">${esc(fmtDate(ws))}</th>`).join('');
  const rows = cov.units.map((u) => {
    const cells = u.cells.map(({ week, walks }) => {
      if (walks.length) {
        const names = [...new Set(walks.map((w) => w.coordinator))].join(', ');
        return `<td><a class="cell ok" href="/walkthroughs/${esc(walks[0].id)}" title="${esc(names)}">✓ ${esc(names)}</a></td>`;
      }
      if (week === currentWeek) {
        return `<td><span class="cell ${u.staleDays == null ? 'never' : 'due'}">${u.staleDays == null ? '✗ never' : '· due'}</span></td>`;
      }
      return `<td><span class="cell gap">—</span></td>`;
    }).join('');
    return `<tr>
      <td class="unit">${dormIcon(u.lodge, 17)} <a href="/lodges/${encodeURIComponent(u.lodge)}">${esc(u.lodge)}</a> · ${esc(u.floor)} <span class="use-note">${esc(u.wings.join(' '))}</span></td>
      ${cells}
      <td class="num" title="days since last walkthrough">${u.staleDays == null ? '<span class="cell never">✗ never walked</span>' : `${u.staleDays}d ago`}</td>
    </tr>`;
  }).join('');
  return `<table class="data covgrid">
    <tr><th>Lodge · floor (wings)</th>${head}<th>Last walked</th></tr>${rows}
  </table>`;
}

export function overviewBody({ s, health, weekly, streakMetrics, weekIssues, longTerm }) {
  return `
  <h1>Lodge ambiance</h1>
  <p class="sub">${s.open} open issues · ${s.high} high priority · ${s.thisWeek} walkthrough${s.thisWeek === 1 ? '' : 's'} this week · ${s.resolved30} resolved in the last 30 days</p>

  <h2>Dormitory health</h2>
  <div class="lodgecards">${health.map(lodgeCard).join('')}</div>

  <h2>Weekly Walkthrough (${esc(fmtWeek(weekly.weekStart))})</h2>
  <div class="card">${coordBubbles(weekly)}</div>

  <h2>Last 6 weeks</h2>
  <div class="card">${streakTable(streakMetrics)}</div>

  <h2>This week's issues <a style="font-size:13px;font-weight:400" href="/issues">see all issues →</a></h2>
  <div class="card">${longestOpenTable(weekIssues, { emptyMsg: 'No issues reported this week yet.' })}</div>

  <h2>Long term issues <span class="h-sub">open 2+ weeks</span></h2>
  <div class="card">${longestOpenTable(longTerm, { emptyMsg: 'Nothing has been open for more than two weeks. 🎉' })}</div>`;
}

export function lodgeBody({ health, issues, floorWalks, walks, cov }) {
  const byFloor = { First: [], Second: [] };
  for (const i of issues) (byFloor[i.floor] ??= []).push(i);

  const floorSections = Object.entries(byFloor).map(([floor, list]) => {
    const last = floorWalks.get(floor);
    const lastTxt = last
      ? `last walked ${fmtDate(last.walk_date)} by ${esc(last.coordinator)}`
      : `<span class="status-miss">never walked</span>`;
    const floorOwners = lodgeOwnersFor(health.lodge, floor).join(', ');
    return `
    <h2>${esc(floorLabel(floor))} <span class="h-sub">· coord: ${esc(floorOwners)} · ${lastTxt} · ${list.length} open</span></h2>
    <div class="card">${issuesTable(list, { areaOnly: true })}</div>`;
  }).join('');

  const lodgeUnits = cov.units.filter((u) => u.lodge === health.lodge);

  return `
  <p class="crumb"><a href="/">← Overview</a></p>
  <h1>${dormIcon(health.lodge, 34)} ${esc(health.lodge)}</h1>
  <p class="sub">${health.label ? esc(health.label) + ' · ' : ''}coordinator${lodgeOwnersFor(health.lodge).length === 1 ? '' : 's'}: ${esc(lodgeOwnersFor(health.lodge).join(', ') || '—')}</p>
  <p class="lodge-stats">
    <span><b>${health.open}</b> open issue${health.open === 1 ? '' : 's'}</span>
    <span class="${health.high ? 'is-bad' : ''}"><b>${health.high}</b> high priority</span>
  </p>

  <h2>Walkthroughs — last ${cov.weekStarts.length} weeks</h2>
  <div class="card">${coverageGrid({ weekStarts: cov.weekStarts, units: lodgeUnits })}</div>

  ${floorSections}

  <h2>Recent walkthroughs</h2>
  <div class="card">
    <table class="data">
      <tr><th>Walked</th><th>Floor</th><th>Coordinator</th><th>Issues</th><th>Photos</th><th></th></tr>
      ${walks.map((w) => `<tr>
        <td class="num">${fmtDate(w.walk_date)}</td>
        <td>${esc(floorLabel(w.floor))}</td><td>${esc(w.coordinator)}</td>
        <td class="num">${w.issue_count}</td><td class="num">${w.photo_count}</td>
        <td><a href="/walkthroughs/${esc(w.id)}">open →</a></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">No walkthroughs yet.</td></tr>'}
    </table>
  </div>`;
}

export function issuesBody({ issues, filters, lodgesList }) {
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === (cur || '') ? 'selected' : ''}>${esc(label ?? (v || 'all'))}</option>`;
  return `
  <h1>Open issues <span class="sub" style="font-size:14px">(${issues.length})</span></h1>
  <form class="filters" method="get" action="/issues">
    <select name="lodge" onchange="this.form.submit()">${['', ...lodgesList].map((l) => opt(l, filters.lodge, l || 'all lodges')).join('')}</select>
    <select name="category" onchange="this.form.submit()">${['', ...CATEGORIES].map((c) => opt(c, filters.category, c ? `${CAT_ICON[c]} ${CAT_LABEL[c]}` : 'all categories')).join('')}</select>
    <select name="severity" onchange="this.form.submit()">${opt('', filters.severity, 'any severity')}${opt('high', filters.severity, '⚠ high')}${opt('normal', filters.severity, 'normal')}</select>
    <input type="search" name="q" placeholder="search… (press enter)" value="${esc(filters.q || '')}">
    ${filters.lodge || filters.category || filters.severity || filters.q ? '<a class="btn" href="/issues">Clear</a>' : ''}
  </form>
  <div class="card">${issuesTable(issues)}</div>
  <p class="sub">Issues stay open until someone marks them resolved — on the dashboard or via the check-off link in a follow-up message.</p>`;
}


export function walkthroughDetailBody({ walk, areas, photos, sightings }) {
  const areaRows = areas.map((a) => {
    const statuses = JSON.parse(a.statuses_json || '[]');
    return `<tr>
      <td class="nowrap"><b>${esc(a.area)}</b>${a.skipped ? '<br><span class="skip">skipped / N-A</span>' : ''}</td>
      <td class="statuses">${statuses.map(esc).join(' · ') || '<span class="skip">—</span>'}</td>
      <td class="note">${esc(a.note || '')}</td>
    </tr>`;
  }).join('');

  return `
  <p class="crumb"><a href="/lodges/${encodeURIComponent(walk.lodge)}">← ${esc(walk.lodge)}</a></p>
  <h1>${esc(walk.lodge)} — ${esc(floorLabel(walk.floor))}</h1>
  <p class="kv">Walked <b>${fmtDate(walk.walk_date)}</b> by <b>${esc(walk.coordinator)}</b>
     · submitted ${esc((walk.submitted_at || '').slice(0, 16))}
     · <a href="https://www.jotform.com/submission/${esc(walk.id)}" target="_blank" rel="noreferrer">view in JotForm ↗</a></p>
  ${walk.comments ? `<div class="card"><b>Comments</b><p class="note">${esc(walk.comments)}</p></div>` : ''}

  <h2>Checklist</h2>
  <div class="card"><table class="data">
    <tr><th>Area</th><th>Checked</th><th>Notes</th></tr>${areaRows}
  </table></div>

  ${photos.length ? `<h2>Photos (${photos.length})</h2>
  <div class="card"><div class="photos">
    ${photos.map((p) => {
      const u = encodeURIComponent(p.url);
      return `<a href="/photo?u=${u}" target="_blank"><img loading="lazy" decoding="async" width="132" height="132" src="/photo?u=${u}&s=t" alt="walkthrough photo"></a>`;
    }).join('')}
  </div></div>` : ''}

  <details class="collapse">
    <summary><span class="chev">▸</span> Extracted action items (${sightings.length})</summary>
    <div class="card">${issuesTable(sightings)}</div>
  </details>`;
}

/** Coordinator × week streak grid ("Last 6 weeks" on the overview). */
export function streakTable(m) {
  const currentWeek = weekStart(today());
  const head = m.weekStarts.map((ws) =>
    `<th title="Week of ${esc(fmtWeek(ws))}" ${ws === currentWeek ? 'class="thisweek"' : ''}>${esc(fmtDate(ws))}</th>`).join('');
  const rows = m.streak.map((c) => {
    const cfg = coordinators.coordinators.find((x) => x.name === c.name);
    const cells = c.cells.map((n, idx) => {
      const isNow = m.weekStarts[idx] === currentWeek;
      if (n > 0) return `<td class="${isNow ? 'thisweek' : ''}"><span class="dot did" title="${n} walkthrough${n > 1 ? 's' : ''}">✓${n > 1 ? n : ''}</span></td>`;
      return `<td class="${isNow ? 'thisweek' : ''}"><span class="dot ${isNow ? 'pending' : 'not'}" title="${isNow ? 'not yet this week' : 'no walkthrough'}">${isNow ? '·' : '—'}</span></td>`;
    }).join('');
    return `<tr>
      <td class="nowrap"><span class="who">${avatar(c.name, 'xs')} <b>${esc(c.name)}</b> <span class="muted" style="font-size:12px">${cfg ? esc(responsibilityLabel(cfg)) : ''}</span></span></td>
      ${cells}
      <td class="num">${c.n}</td>
      <td class="num">${c.lastWalked ? fmtDate(c.lastWalked) : '<span class="muted">never</span>'}</td>
    </tr>`;
  }).join('');
  return `<table class="data streak">
    <tr><th>Coordinator</th>${head}<th>Total</th><th>Last walked</th></tr>
    ${rows}
  </table>`;
}

export function issueDetailBody({ issue, sightings, similar }) {
  const statusChip = {
    open: '<span class="chip st-open">● open</span>',
    resolved: '<span class="chip st-resolved">✓ resolved</span>',
    dismissed: '<span class="chip st-dismissed">✕ dismissed</span>',
  }[issue.status] || esc(issue.status);

  const historyRows = sightings.map((s) => `<tr>
    <td class="num">${fmtDate(s.seen_date)}</td>
    <td class="nowrap">${esc(s.coordinator || '—')}</td>
    <td class="desc">${esc(s.text)}</td>
    <td class="nowrap"><a href="/walkthroughs/${esc(s.walkthrough_id)}">walkthrough →</a></td>
  </tr>`).join('');

  const similarRows = similar.map((r) => `<tr>
    <td class="nowrap">${whereLabel(r)}</td>
    <td class="desc"><a href="/issue/${r.id}">${esc(r.description)}</a></td>
    <td class="nowrap">${{
      open: '<span class="chip st-open">● open</span>',
      resolved: '<span class="chip st-resolved">✓ resolved</span>',
      dismissed: '<span class="chip st-dismissed">✕ dismissed</span>',
    }[r.status] || esc(r.status)}</td>
    <td class="num">${fmtDate(r.last_seen)}</td>
  </tr>`).join('');

  return `
  <p class="crumb"><a href="/issues">← Issues</a></p>
  <h1 style="font-size:20px">${esc(issue.description)}</h1>
  <p class="sub">${whereLabel(issue)} · ${chips(issue)} ${statusChip}</p>

  <p>
    ${issue.status === 'open' ? `${followUpButton(contactsForIssue(issue), issueMessage(issue))} ${resolveForms(issue)}
      <form class="inline" method="post" action="/issues/${issue.id}/status">
        <input type="hidden" name="status" value="dismissed"><button title="Not actionable / duplicate">✕ Dismiss</button>
      </form>`
    : `<form class="inline" method="post" action="/issues/${issue.id}/status">
        <input type="hidden" name="status" value="open"><button>↩ Reopen</button>
      </form>${issue.resolved_at ? ` <span class="muted">closed ${fmtDate(issue.resolved_at)}${issue.resolved_by ? ` via ${esc(issue.resolved_by)}` : ''}</span>` : ''}`}
  </p>

  <h2>History — reported ${issue.occurrences}× since ${fmtDate(issue.first_seen)}</h2>
  <div class="card"><table class="data">
    <tr><th>Seen</th><th>Reported by</th><th>Exact words</th><th></th></tr>
    ${historyRows}
  </table></div>

  <h2>Similar issues ${similar.length ? `(${similar.length})` : ''}</h2>
  ${similar.length
    ? `<div class="card"><table class="data">
        <tr><th>Where</th><th>Issue</th><th>Status</th><th>Last seen</th></tr>
        ${similarRows}
      </table></div>
      <p class="sub">Matched on wording — recurring themes (a “water dispenser” problem that keeps coming back) show up here even across lodges or already-resolved entries.</p>`
    : '<div class="card"><div class="empty">Nothing similar on record.</div></div>'}`;
}

/** Standalone magic-link pages (opened from WhatsApp/email, no login). */
export function magicConfirmBody({ issue, token }) {
  return `
  <div style="max-width:480px;margin:30px auto;text-align:center">
    <h1>Check this off?</h1>
    <div class="card" style="text-align:left">
      <p><b>${esc(issue.description)}</b></p>
      <p class="sub" style="margin:0">${whereLabel(issue)} · first seen ${fmtDate(issue.first_seen)} · reported ${issue.occurrences}×</p>
    </div>
    ${issue.status === 'resolved'
      ? `<p class="status-ok" style="font-size:16px">✓ Already marked done${issue.resolved_at ? ` on ${fmtDate(issue.resolved_at)}` : ''}.</p>`
      : `<form method="post" action="/r/${esc(token)}">
           <button class="btn-followup" style="font-size:16px;padding:13px 26px">✓ Yes, it's done</button>
         </form>`}
  </div>`;
}

export function magicDoneBody({ issue, token }) {
  return `
  <div style="max-width:480px;margin:30px auto;text-align:center">
    <h1>✓ Checked off</h1>
    <div class="card" style="text-align:left">
      <p><b>${esc(issue.description)}</b></p>
      <p class="sub" style="margin:0">${whereLabel(issue)}</p>
    </div>
    <p class="status-ok" style="font-size:16px">Marked done — thank you! It drops off the open list and next week's digest.</p>
    <form method="post" action="/r/${esc(token)}?undo=1"><button>↩ Undo — not actually done</button></form>
  </div>`;
}

export function digestBody({ names, selected, html }) {
  return `
  <h1>Weekly digest preview</h1>
  <p class="sub">Exactly what <code>npm run digest</code> produces per coordinator. Cron this on Madhu's laptop; use <code>--send</code> once SMTP is configured.</p>
  <form class="filters" method="get" action="/digest">
    <select name="who" onchange="this.form.submit()">
      ${names.map((n) => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
  </form>
  <div class="card" style="padding:0">
    <iframe srcdoc="${esc(html)}" style="width:100%;height:1200px;border:0;border-radius:10px;background:#fcfcfb"></iframe>
  </div>`;
}
