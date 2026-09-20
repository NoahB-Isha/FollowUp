import { esc } from './layout.js';
import { coordinators, app } from '../config.js';
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

function chips(issue, latestByUnit) {
  const out = [`<span class="chip cat-${esc(issue.category)}">${CAT_LABEL[issue.category] || esc(issue.category)}</span>`];
  if (issue.severity === 'high') out.push(`<span class="chip sev-high">⚠ high</span>`);
  const age = issueAge(issue);
  out.push(`<span class="chip ${age >= 14 ? 'age-old' : ''}">${age === 0 ? 'new today' : `${age}d open`}</span>`);
  if (issue.occurrences > 1) out.push(`<span class="chip recur">seen ${issue.occurrences}×</span>`);
  const latest = latestByUnit?.get(`${issue.lodge}|${issue.floor}`);
  if (latest && issue.last_seen < latest) {
    out.push(`<span class="chip stale-hint" title="Did not come up in the most recent walkthrough of ${esc(issue.lodge)} ${esc(issue.floor)} floor (${fmtDate(latest)}) — may be fixed">✓? not seen ${fmtDate(latest)}</span>`);
  }
  return out.join(' ');
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
    <form class="inline" method="post" action="/issues/${issue.id}/status">
      <input type="hidden" name="status" value="resolved"><button title="Mark resolved">✓ Resolve</button>
    </form>
    <form class="inline" method="post" action="/issues/${issue.id}/status">
      <input type="hidden" name="status" value="dismissed"><button title="Not actionable / duplicate">✕</button>
    </form>`;
}

export function issuesTable(issues, latestByUnit, { showActions = true } = {}) {
  if (!issues.length) return `<div class="empty">No open issues match.</div>`;
  return `<table class="data">
    <tr><th>Where</th><th>Issue</th><th></th><th>First seen</th>${showActions ? '<th>Assign / act</th>' : ''}</tr>
    ${issues.map((i) => `<tr>
      <td class="nowrap"><b>${esc(i.lodge)}</b> · ${esc(i.floor)} · ${esc(i.area)}</td>
      <td class="desc">${esc(i.description)}</td>
      <td class="chips">${chips(i, latestByUnit)}</td>
      <td class="num">${fmtDate(i.first_seen)}</td>
      ${showActions ? `<td class="nowrap">${issueActions(i)}</td>` : ''}
    </tr>`).join('')}
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
        const links = walks.map((w) => w.id);
        return `<td><a class="cell ok" href="/walkthroughs/${esc(links[0])}" title="${esc(names)}">✓ ${esc(names)}</a></td>`;
      }
      if (week === currentWeek) {
        return `<td><span class="cell ${u.staleDays == null ? 'never' : 'due'}">${u.staleDays == null ? '✗ never' : '· due'}</span></td>`;
      }
      return `<td><span class="cell gap">—</span></td>`;
    }).join('');
    const wings = u.wings.join(' ');
    return `<tr>
      <td class="unit">${esc(u.lodge)} · ${esc(u.floor)} <span class="use-note">${esc(wings)}</span></td>
      ${cells}
      <td class="num" title="days since last walkthrough">${u.staleDays == null ? '<span class="cell never">✗ never walked</span>' : `${u.staleDays}d ago`}</td>
    </tr>`;
  }).join('');
  return `<table class="data covgrid">
    <tr><th>Lodge · floor (wings)</th>${head}<th>Last walked</th></tr>${rows}
  </table>`;
}

export function overviewBody({ s, cov, issues, latestByUnit, recent }) {
  const oldest = issues.slice(0, 8);
  return `
  <h1>Lodge ambiance — overview</h1>
  <div class="tiles">
    <div class="tile"><div class="value">${s.open}</div><div class="label">open issues</div></div>
    <div class="tile"><div class="value ${s.high ? 'bad' : ''}">${s.high}</div><div class="label">high priority</div></div>
    <div class="tile"><div class="value">${s.thisWeek}</div><div class="label">walkthroughs this week</div></div>
    <div class="tile"><div class="value ok">${s.resolved30}</div><div class="label">resolved in last 30 days</div></div>
  </div>

  <h2>Walkthrough coverage — last ${cov.weekStarts.length} weeks</h2>
  <div class="card">${coverageGrid(cov)}</div>

  <h2>Longest-open issues <a style="font-size:13px;font-weight:400" href="/issues">see all →</a></h2>
  <div class="card">${issuesTable(oldest, latestByUnit)}</div>

  <h2>Recent walkthroughs</h2>
  <div class="card">
    <table class="data">
      <tr><th>Walked</th><th>Lodge</th><th>Floor</th><th>Coordinator</th><th>Issues</th><th>Photos</th><th></th></tr>
      ${recent.map((w) => `<tr>
        <td class="num">${fmtDate(w.walk_date)}</td>
        <td>${esc(w.lodge)}</td><td>${esc(w.floor)}</td><td>${esc(w.coordinator)}</td>
        <td class="num">${w.issue_count}</td><td class="num">${w.photo_count}</td>
        <td><a href="/walkthroughs/${esc(w.id)}">open →</a></td>
      </tr>`).join('')}
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

export function walkthroughsBody({ recent }) {
  return `
  <h1>Walkthroughs</h1>
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
  <h1>${esc(walk.lodge)} — ${esc(walk.floor)} floor</h1>
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
