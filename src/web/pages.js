import { esc } from './layout.js';
import { coordinators, phoneFor, contactsForIssue, lodgeOwnersFor } from '../config.js';
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
    'Please take a look and reply here when it’s handled. 🙏',
  ].join('\n');
}

/** One WhatsApp button per responsible contact (lodge owner / assignee + department). */
function contactButtons(i) {
  const msg = issueMessage(i);
  return contactsForIssue(i).map((name) =>
    `<a class="btn wa" target="_blank" rel="noreferrer" href="${waHref(name, msg)}"
        title="${phoneFor(name)
          ? `WhatsApp ${esc(name)} about this`
          : `No number on file for ${esc(name)} — WhatsApp opens with the message ready; pick their chat`}">💬 ${esc(name)}</a>`
  ).join(' ');
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
    ${contactButtons(issue)}
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
        ${contactButtons(i)}
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
  const owners = lodgeOwnersFor(h.lodge).join(', ');
  return `<a class="lodgecard" href="/lodges/${encodeURIComponent(h.lodge)}">
    <div class="lc-top"><span class="lc-name">${esc(h.lodge)}</span>${STATUS_PILL[h.status]}</div>
    <div class="lc-label">${esc([h.label, owners && `coord: ${owners}`].filter(Boolean).join(' · '))}</div>
    <div class="lc-nums">${h.open} open issue${h.open === 1 ? '' : 's'}${h.high ? ` · <b class="bad">${h.high} high priority</b>` : ''}</div>
    <div class="lc-floors">Last walked — ${floors}</div>
  </a>`;
}

function responsibilityLabel(c) {
  if (c.role === 'overall') return 'All lodges (overall)';
  return (c.assignedLodges || []).join(', ') || '—';
}

function weeklyWalkTable(weekly) {
  const rows = coordinators.coordinators.map((c) => {
    const walks = weekly.byCoord.get(c.name) || [];
    const done = walks.length > 0;
    const what = done
      ? walks.map((w) => `<a href="/walkthroughs/${esc(w.id)}">${esc(w.lodge)} ${w.floor === 'First' ? '1st' : '2nd'} (${fmtDate(w.walk_date)})</a>`).join(', ')
      : '<span class="muted">—</span>';
    const scope = c.role === 'overall' ? '' : (c.assignedLodges || []).join(' and ');
    const reminder = waHref(c.name,
      `Hi ${c.name} — friendly reminder to complete your lodge walkthrough${scope ? ` for ${scope}` : ''} this week (${fmtWeek(weekly.weekStart)}) and submit the checklist form. Thank you! 🙏`);
    const action = done
      ? ''
      : `<a class="btn wa" target="_blank" rel="noreferrer" href="${reminder}"
           title="${phoneFor(c.name)
             ? `WhatsApp ${esc(c.name)} a reminder`
             : `No number on file for ${esc(c.name)} — WhatsApp opens with the reminder ready; pick their chat`}">💬 Follow up</a>`;
    return `<tr>
      <td class="nowrap"><b>${esc(c.name)}</b></td>
      <td class="nowrap muted">${esc(responsibilityLabel(c))}</td>
      <td class="nowrap">${done
        ? `<span class="status-ok">✓ Completed${walks.length > 1 ? ` ×${walks.length}` : ''}</span>`
        : `<span class="status-miss">✗ Not yet</span>`}</td>
      <td>${what}</td>
      <td class="nowrap">${action}</td>
    </tr>`;
  }).join('');
  return `<table class="data">
    <tr><th>Coordinator</th><th>Responsible for</th><th>This week</th><th>Walked</th><th></th></tr>${rows}
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
  <p class="sub">${health.label ? esc(health.label) + ' · ' : ''}coordinator${lodgeOwnersFor(health.lodge).length === 1 ? '' : 's'}: ${esc(lodgeOwnersFor(health.lodge).join(', ') || '—')} · ${health.open} open issue${health.open === 1 ? '' : 's'}${health.high ? ` · ${health.high} high priority` : ''}</p>

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

function meter(fraction, text) {
  const pct = Math.round(fraction * 100);
  return `<span class="meter" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></span>${text ?? `${pct}%`}`;
}

export function completionBody({ m }) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lagChip = (d) =>
    d == null ? '—' : d <= 1 ? `${d}d` : `<span class="${d > 3 ? 'status-miss' : ''}" title="${d > 3 ? 'Large gap between walk date and submission — backdated or late entry' : ''}">${d}d</span>`;

  const weeklyRows = [...m.weekly].reverse().map((w) => `<tr>
    <td class="nowrap">${esc(fmtWeek(w.week))}</td>
    <td class="num">${w.walkthroughs}</td>
    <td class="nowrap">${meter(w.unitsCovered / w.totalUnits, `${w.unitsCovered}/${w.totalUnits} floors`)}</td>
    <td class="num">${w.avgCompleteness == null ? '—' : pct(w.avgCompleteness)}</td>
    <td>${w.coordinators.map(esc).join(', ') || '<span class="muted">—</span>'}</td>
  </tr>`).join('');

  const coordRows = m.perCoordinator.map((c) => {
    const cfg = coordinators.coordinators.find((x) => x.name === c.name);
    const resp = cfg ? responsibilityLabel(cfg) : '—';
    if (!c.n) {
      return `<tr><td class="nowrap"><b>${esc(c.name)}</b></td><td class="nowrap muted">${esc(resp)}</td>
        <td class="num">0</td><td colspan="4" class="muted">never submitted</td><td></td></tr>`;
    }
    return `<tr>
      <td class="nowrap"><b>${esc(c.name)}</b></td>
      <td class="nowrap muted">${esc(resp)}</td>
      <td class="num">${c.n}</td>
      <td class="nowrap">${meter(c.weeksActive / c.weeksSpan, `${c.weeksActive}/${c.weeksSpan} weeks`)}</td>
      <td class="num">${pct(c.avgCompleteness)}</td>
      <td class="num">${lagChip(c.medianLag)}</td>
      <td class="num">${c.avgPhotos.toFixed(0)}</td>
      <td class="num">${fmtDate(c.lastWalked)}</td>
    </tr>`;
  }).join('');

  const sectionRows = m.sectionRates.map((s) => `<tr>
    <td class="nowrap">${esc(s.section)}</td>
    <td class="nowrap">${meter(s.total ? s.filled / s.total : 0)}</td>
    <td class="num">${s.filled}/${s.total}</td>
  </tr>`).join('');

  return `
  <h1>Form completion</h1>
  <p class="sub">How consistently and thoroughly the walkthrough form is being used — worth trusting before any cleanliness trend.</p>

  <div class="tiles">
    <div class="tile"><div class="value">${m.summary.total}</div><div class="label">walkthroughs total</div></div>
    <div class="tile"><div class="value">${pct(m.summary.avgCompleteness)}</div><div class="label">avg form completeness</div></div>
    <div class="tile"><div class="value">${m.summary.medianLag}d</div><div class="label">median submit lag</div></div>
    <div class="tile"><div class="value">${m.summary.withPhotos}/${m.summary.total}</div><div class="label">with photos</div></div>
  </div>

  <h2>By week</h2>
  <div class="card"><table class="data">
    <tr><th>Week</th><th>Walkthroughs</th><th>Floor coverage</th><th>Avg completeness</th><th>Who walked</th></tr>
    ${weeklyRows}
  </table></div>

  <h2>By coordinator</h2>
  <div class="card"><table class="data">
    <tr><th>Coordinator</th><th>Responsible for</th><th>Walks</th><th>Weekly consistency</th><th>Avg completeness</th><th>Median submit lag</th><th>Avg photos</th><th>Last walked</th></tr>
    ${coordRows}
  </table></div>

  <h2>Which form sections get filled in</h2>
  <div class="card"><table class="data">
    <tr><th>Section</th><th>Fill rate</th><th></th></tr>
    ${sectionRows}
    <tr><td class="nowrap"><b>Wings (all)</b></td>
      <td class="nowrap">${meter(m.wingTotals.expected ? m.wingTotals.done / m.wingTotals.expected : 0)}</td>
      <td class="num">${m.wingTotals.done}/${m.wingTotals.expected}</td></tr>
  </table></div>

  <p class="sub">Completeness = answered wings + answered sections ÷ expected for that floor (a wing noted “N/A / locked” counts as answered; non-dorm wings are excluded).
  Weekly consistency = weeks with ≥1 submission since that person's first walkthrough.</p>`;
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
