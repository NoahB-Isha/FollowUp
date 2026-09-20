import { esc } from './layout.js';
import { coordinators, emailFor } from '../config.js';
import { issueAge } from '../queries.js';
import { fmtDate, fmtWeek, today, weekStart } from '../util.js';

const CAT_LABEL = { housekeeping: 'Housekeeping', maintenance: 'Maintenance', supplies: 'Supplies', other: 'Other' };
const CATEGORIES = Object.keys(CAT_LABEL);

export function assigneeNames() {
  return [
    ...coordinators.coordinators.map((c) => c.name),
    ...(coordinators.extraRecipients || []).map((c) => c.name),
  ];
}

function floorLabel(floor) {
  return floor === 'First' ? 'First floor' : floor === 'Second' ? 'Second floor' : `${floor} floor`;
}

function whereLabel(i) {
  return `<b>${esc(i.lodge)}</b> · ${esc(floorLabel(i.floor))} · ${esc(i.area)}`;
}

function mailto(to, subject, body) {
  // Address stays unencoded (mail clients dislike %40); subject/body are encoded.
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Pre-filled email for nudging on an issue — goes to the assignee if set. */
function issueFollowUpHref(i) {
  const age = issueAge(i);
  const to = i.assignee ? emailFor(i.assignee) : '';
  const subject = `Follow up: ${i.lodge} ${floorLabel(i.floor)} — ${i.area}`;
  const body = [
    `Issue: ${i.description}`,
    `Where: ${i.lodge}, ${floorLabel(i.floor)}, ${i.area}`,
    `Type: ${CAT_LABEL[i.category] || i.category}${i.severity === 'high' ? ' (high priority)' : ''}`,
    `Open for ${age} day${age === 1 ? '' : 's'} — first seen ${i.first_seen}, reported ${i.occurrences}×`,
    '',
    'Please take a look and reply when it’s handled.',
  ].join('\n');
  return mailto(to, subject, body);
}

function ageText(i) {
  const age = issueAge(i);
  const t = age === 0 ? 'opened today' : `open for ${age} day${age === 1 ? '' : 's'}`;
  return `<span class="age ${age >= 14 ? 'old' : ''}">${t}</span>`;
}

function chips(issue, latestByUnit) {
  const out = [`<span class="chip cat-${esc(issue.category)}">${CAT_LABEL[issue.category] || esc(issue.category)}</span>`];
  if (issue.severity === 'high') out.push(`<span class="chip sev-high">⚠ high</span>`);
  out.push(`<span class="chip ${issueAge(issue) >= 14 ? 'age-old' : ''}">${issueAge(issue)}d open</span>`);
  if (issue.occurrences > 1) out.push(`<span class="chip recur">seen ${issue.occurrences}×</span>`);
  const latest = latestByUnit?.get(`${issue.lodge}|${issue.floor}`);
  if (latest && issue.last_seen < latest) {
    out.push(`<span class="chip stale-hint" title="Did not come up in the most recent walkthrough of ${esc(issue.lodge)} ${esc(floorLabel(issue.floor))} (${fmtDate(latest)}) — may be fixed">✓? not seen ${fmtDate(latest)}</span>`);
  }
  return out.join(' ');
}

function resolveForms(i) {
  return `
    <form class="inline" method="post" action="/issues/${i.id}/status">
      <input type="hidden" name="status" value="resolved"><button title="Mark resolved">✓ Resolve</button>
    </form>`;
}

function issueActions(issue) {
  const opts = assigneeNames().map((n) =>
    `<option value="${esc(n)}" ${issue.assignee === n ? 'selected' : ''}>${esc(n)}</option>`).join('');
  return `
    <form class="inline" method="post" action="/issues/${issue.id}/assign">
      <select name="assignee" onchange="this.form.submit()">
        <option value="">unassigned</option>${opts}
      </select>
    </form>
    <a class="btn" href="${issueFollowUpHref(issue)}" title="Open a pre-filled follow-up email${issue.assignee ? ` to ${esc(issue.assignee)}` : ' (pick the recipient in your mail app)'}">✉ Follow up</a>
    ${resolveForms(issue)}
    <form class="inline" method="post" action="/issues/${issue.id}/status">
      <input type="hidden" name="status" value="dismissed"><button title="Not actionable / duplicate">✕</button>
    </form>`;
}

/** Full-featured table used on the Issues page, lodge pages, and walkthrough detail. */
export function issuesTable(issues, latestByUnit, { areaOnly = false } = {}) {
  if (!issues.length) return `<div class="empty">No open issues match.</div>`;
  return `<table class="data">
    <tr><th>Where</th><th>Issue</th><th></th><th>First seen</th><th>Assign / act</th></tr>
    ${issues.map((i) => `<tr>
      <td class="nowrap">${areaOnly ? `<b>${esc(i.area)}</b>` : whereLabel(i)}</td>
      <td class="desc">${esc(i.description)}</td>
      <td class="chips">${chips(i, latestByUnit)}</td>
      <td class="num">${fmtDate(i.first_seen)}</td>
      <td class="nowrap">${issueActions(i)}</td>
    </tr>`).join('')}
  </table>`;
}

/** Descriptive longest-open list for the overview: where, what, type + age, follow up / resolve. */
export function longestOpenTable(issues) {
  if (!issues.length) return `<div class="empty">Nothing open. 🎉</div>`;
  return `<table class="data">
    <tr><th>Where</th><th>Issue</th><th>Type &amp; age</th><th>Act</th></tr>
    ${issues.map((i) => `<tr>
      <td class="nowrap">${whereLabel(i)}</td>
      <td class="desc">${esc(i.description)}${i.occurrences > 1 ? ` <span class="muted">(reported ${i.occurrences}×)</span>` : ''}</td>
      <td class="nowrap">${CAT_LABEL[i.category] || esc(i.category)}${i.severity === 'high' ? ' <span class="chip sev-high">⚠ high</span>' : ''}<br>${ageText(i)}</td>
      <td class="nowrap">
        <a class="btn" href="${issueFollowUpHref(i)}" title="Open a pre-filled follow-up email">✉ Follow up</a>
        ${resolveForms(i)}
      </td>
    </tr>`).join('')}
  </table>`;
}

const STATUS_PILL = {
  good: `<span class="pill good">✓ All clear</span>`,
  warning: `<span class="pill warn">⚠ Needs attention</span>`,
  critical: `<span class="pill crit">‼ High priority</span>`,
};

function lodgeCard(h) {
  const floors = h.floors.map((f) =>
    `${f.floor === 'First' ? '1st' : '2nd'}: ${f.lastWalked ? `${fmtDate(f.lastWalked)}${f.staleDays > 10 ? ' ⚠' : ''}` : 'never walked'}`
  ).join(' · ');
  return `<a class="lodgecard" href="/lodges/${encodeURIComponent(h.lodge)}">
    <div class="lc-top"><span class="lc-name">${esc(h.lodge)}</span>${STATUS_PILL[h.status]}</div>
    ${h.label ? `<div class="lc-label">${esc(h.label)}</div>` : ''}
    <div class="lc-nums">${h.open} open issue${h.open === 1 ? '' : 's'}${h.high ? ` · <b class="bad">${h.high} high priority</b>` : ''}</div>
    <div class="lc-floors">Last walked — ${floors}</div>
  </a>`;
}

function weeklyWalkTable(weekly) {
  const rows = coordinators.coordinators.map((c) => {
    const walks = weekly.byCoord.get(c.name) || [];
    const done = walks.length > 0;
    const what = done
      ? walks.map((w) => `<a href="/walkthroughs/${esc(w.id)}">${esc(w.lodge)} ${w.floor === 'First' ? '1st' : '2nd'} (${fmtDate(w.walk_date)})</a>`).join(', ')
      : '<span class="muted">—</span>';
    const email = emailFor(c.name);
    const reminder = mailto(email,
      `Walkthrough reminder — week of ${fmtWeek(weekly.weekStart)}`,
      `Hi ${c.name},\n\nFriendly reminder to complete your lodge walkthrough this week and submit the checklist form.\n\nThank you!`);
    const action = done
      ? ''
      : email
        ? `<a class="btn" href="${reminder}" title="Open a pre-filled reminder email to ${esc(c.name)}">✉ Follow up</a>`
        : '<span class="muted" title="Add their address to config/coordinators.local.json">no email on file</span>';
    return `<tr>
      <td class="nowrap"><b>${esc(c.name)}</b></td>
      <td class="nowrap">${done
        ? `<span class="status-ok">✓ Completed${walks.length > 1 ? ` ×${walks.length}` : ''}</span>`
        : `<span class="status-miss">✗ Not yet</span>`}</td>
      <td>${what}</td>
      <td class="nowrap">${action}</td>
    </tr>`;
  }).join('');
  return `<table class="data">
    <tr><th>Coordinator</th><th>This week</th><th>Walked</th><th></th></tr>${rows}
  </table>`;
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
      <td class="unit"><a href="/lodges/${encodeURIComponent(u.lodge)}">${esc(u.lodge)}</a> · ${esc(u.floor)} <span class="use-note">${esc(u.wings.join(' '))}</span></td>
      ${cells}
      <td class="num" title="days since last walkthrough">${u.staleDays == null ? '<span class="cell never">✗ never walked</span>' : `${u.staleDays}d ago`}</td>
    </tr>`;
  }).join('');
  return `<table class="data covgrid">
    <tr><th>Lodge · floor (wings)</th>${head}<th>Last walked</th></tr>${rows}
  </table>`;
}

export function overviewBody({ s, health, weekly, longest }) {
  return `
  <h1>Lodge ambiance</h1>
  <p class="sub">${s.open} open issues · ${s.high} high priority · ${s.thisWeek} walkthrough${s.thisWeek === 1 ? '' : 's'} this week · ${s.resolved30} resolved in the last 30 days</p>

  <h2>Dormitory health</h2>
  <div class="lodgecards">${health.map(lodgeCard).join('')}</div>

  <h2>Weekly walkthrough — ${esc(fmtWeek(weekly.weekStart))}</h2>
  <div class="card">${weeklyWalkTable(weekly)}</div>

  <h2>Longest open issues <a style="font-size:13px;font-weight:400" href="/issues">see all →</a></h2>
  <div class="card">${longestOpenTable(longest)}</div>`;
}

export function lodgeBody({ health, issues, latestByUnit, floorWalks, walks }) {
  const byFloor = { First: [], Second: [] };
  for (const i of issues) (byFloor[i.floor] ??= []).push(i);

  const floorSections = Object.entries(byFloor).map(([floor, list]) => {
    const last = floorWalks.get(floor);
    const lastTxt = last
      ? `last walked ${fmtDate(last.walk_date)} by ${esc(last.coordinator)}`
      : `<span class="status-miss">never walked</span>`;
    return `
    <h2>${esc(floorLabel(floor))} <span class="h-sub">· ${lastTxt} · ${list.length} open</span></h2>
    <div class="card">${issuesTable(list, latestByUnit, { areaOnly: true })}</div>`;
  }).join('');

  return `
  <p class="crumb"><a href="/">← Overview</a></p>
  <h1>${esc(health.lodge)} ${STATUS_PILL[health.status]}</h1>
  <p class="sub">${health.label ? esc(health.label) + ' · ' : ''}${health.open} open issue${health.open === 1 ? '' : 's'}${health.high ? ` · ${health.high} high priority` : ''}</p>

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

export function issuesBody({ issues, latestByUnit, filters, lodgesList }) {
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === (cur || '') ? 'selected' : ''}>${esc(label ?? (v || 'all'))}</option>`;
  return `
  <h1>Open issues <span class="sub" style="font-size:14px">(${issues.length})</span></h1>
  <form class="filters" method="get" action="/issues">
    <select name="lodge">${['', ...lodgesList].map((l) => opt(l, filters.lodge, l || 'all lodges')).join('')}</select>
    <select name="category">${['', ...CATEGORIES].map((c) => opt(c, filters.category, c ? CAT_LABEL[c] : 'all categories')).join('')}</select>
    <select name="severity">${opt('', filters.severity, 'any severity')}${opt('high', filters.severity, '⚠ high')}${opt('normal', filters.severity, 'normal')}</select>
    <select name="assignee">${['', ...assigneeNames()].map((a) => opt(a, filters.assignee, a || 'any assignee')).join('')}</select>
    <input type="search" name="q" placeholder="search text…" value="${esc(filters.q || '')}">
    <button class="primary">Filter</button>
    <a class="btn" href="/issues">Clear</a>
  </form>
  <div class="card">${issuesTable(issues, latestByUnit)}</div>
  <p class="sub">“✓? not seen” = the issue didn’t come up in the latest walkthrough of that floor — worth confirming, then Resolve.</p>`;
}

export function walkthroughsBody({ cov, recent }) {
  return `
  <h1>Walkthroughs</h1>
  <h2>Coverage — last ${cov.weekStarts.length} weeks</h2>
  <div class="card">${coverageGrid(cov)}</div>
  <h2>All submissions</h2>
  <div class="card">
    <table class="data">
      <tr><th>Walked</th><th>Submitted</th><th>Lodge</th><th>Floor</th><th>Coordinator</th><th>Issues</th><th>Photos</th><th></th></tr>
      ${recent.map((w) => `<tr>
        <td class="num">${fmtDate(w.walk_date)}</td>
        <td class="num">${esc((w.submitted_at || '').slice(0, 10))}</td>
        <td>${esc(w.lodge)}</td><td>${esc(w.floor)}</td><td>${esc(w.coordinator)}</td>
        <td class="num">${w.issue_count}</td><td class="num">${w.photo_count}</td>
        <td><a href="/walkthroughs/${esc(w.id)}">open →</a></td>
      </tr>`).join('')}
    </table>
  </div>`;
}

export function walkthroughDetailBody({ walk, areas, photos, sightings, latestByUnit }) {
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

  <h2>Extracted action items (${sightings.length})</h2>
  <div class="card">${issuesTable(sightings, latestByUnit)}</div>

  <h2>Raw checklist</h2>
  <div class="card"><table class="data">
    <tr><th>Area</th><th>Checked</th><th>Notes</th></tr>${areaRows}
  </table></div>

  ${photos.length ? `<h2>Photos (${photos.length})</h2>
  <div class="card"><div class="photos">
    ${photos.map((p) => {
      const u = encodeURIComponent(p.url);
      return `<a href="/photo?u=${u}" target="_blank"><img loading="lazy" decoding="async" width="132" height="132" src="/photo?u=${u}&s=t" alt="walkthrough photo"></a>`;
    }).join('')}
  </div></div>` : ''}`;
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
