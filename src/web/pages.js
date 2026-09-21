import { esc } from './layout.js';
import { coordinators, phoneFor, contactsForIssue, lodgeOwnersFor, lodges as lodgesCfg } from '../config.js';
import { issueAge } from '../queries.js';
import { magicUrl } from '../links.js';
import { fmtDate, fmtWeek, today, weekStart } from '../util.js';

const CAT_LABEL = { housekeeping: 'Housekeeping', maintenance: 'Maintenance', supplies: 'Supplies', other: 'Other' };
const CAT_ICON = { housekeeping: '🧹', maintenance: '🔧', supplies: '📦', other: '📌' };
const CATEGORIES = Object.keys(CAT_LABEL);

function catBadge(category) {
  return `${CAT_ICON[category] || CAT_ICON.other} ${CAT_LABEL[category] || esc(category)}`;
}

function floorLabel(floor) {
  return floor === 'First' ? 'First floor' : floor === 'Second' ? 'Second floor' : `${floor} floor`;
}

function lodgeIcon(lodge) {
  return lodgesCfg.icons?.[lodge] ?? '🏠';
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
function followUpButton(contacts, msg) {
  // ✳ marks contacts with no WhatsApp number on file (config/coordinators.local.json):
  // the link still opens WhatsApp with the message ready, but can't pick the chat itself.
  if (contacts.length <= 1) {
    const name = contacts[0] || '';
    return `<a class="btn-followup" target="_blank" rel="noreferrer" href="${waHref(name, msg)}" title="${waTitle(name)}">${SEND_ICON} Follow up${phoneFor(name) ? '' : '<sup class="nonum">✳</sup>'}</a>`;
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

/** Descriptive longest-open list for the overview: where, what, type + age, follow up / resolve. */
export function longestOpenTable(issues) {
  if (!issues.length) return `<div class="empty">Nothing open. 🎉</div>`;
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
    <div class="lc-top"><span class="lc-name"><span class="lc-icon">${lodgeIcon(h.lodge)}</span> ${esc(h.lodge)}</span>${STATUS_PILL[h.status]}</div>
    <div class="lc-label">${esc([h.label, owners && `coord: ${owners}`].filter(Boolean).join(' · '))}</div>
    <div class="lc-nums">${h.open} open issue${h.open === 1 ? '' : 's'}${h.high ? ` · <b class="bad">${h.high} high priority</b>` : ''}</div>
    <div class="lc-floors">Last walked — ${floors}</div>
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

function weeklyWalkTable(weekly) {
  const rows = coordinators.coordinators.map((c) => {
    const walks = weekly.byCoord.get(c.name) || [];
    const done = walks.length > 0;
    const what = done
      ? walks.map((w) => `<a href="/walkthroughs/${esc(w.id)}">${esc(w.lodge)} ${w.floor === 'First' ? '1st' : '2nd'} (${fmtDate(w.walk_date)})</a>`).join(', ')
      : '<span class="muted">—</span>';
    const scope = c.role === 'overall' ? '' : responsibilityLabel(c).replace('—', '');
    const reminder = `Hi ${c.name} — friendly reminder to complete your lodge walkthrough${scope ? ` for ${scope}` : ''} this week (${fmtWeek(weekly.weekStart)}) and submit the checklist form. Thank you! 🙏`;
    const action = done ? '' : followUpButton([c.name], reminder);
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
      <td class="unit">${lodgeIcon(u.lodge)} <a href="/lodges/${encodeURIComponent(u.lodge)}">${esc(u.lodge)}</a> · ${esc(u.floor)} <span class="use-note">${esc(u.wings.join(' '))}</span></td>
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
  <h1>${lodgeIcon(health.lodge)} ${esc(health.lodge)} ${STATUS_PILL[health.status]}</h1>
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

export function walkthroughsBody({ cov, recent, showingAll, totalCount }) {
  return `
  <h1>Walkthroughs</h1>
  <h2>Coverage — last ${cov.weekStarts.length} weeks</h2>
  <div class="card">${coverageGrid(cov)}</div>
  <h2>${showingAll ? `All submissions (${totalCount})` : `Last ${cov.weekStarts.length} weeks`}
    ${!showingAll && totalCount > recent.length ? `<a class="btn" style="margin-left:8px" href="/walkthroughs?all=1">See all ${totalCount} →</a>` : ''}
    ${showingAll ? `<a class="btn" style="margin-left:8px" href="/walkthroughs">Back to recent</a>` : ''}</h2>
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

  <h2>Extracted action items (${sightings.length})</h2>
  <div class="card">${issuesTable(sightings)}</div>

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
  const currentWeek = weekStart(today());

  // The visual: coordinator × week streak grid.
  const streakHead = m.weekStarts.map((ws) =>
    `<th title="Week of ${esc(fmtWeek(ws))}" ${ws === currentWeek ? 'class="thisweek"' : ''}>${esc(fmtDate(ws))}</th>`).join('');
  const streakRows = m.streak.map((c) => {
    const cfg = coordinators.coordinators.find((x) => x.name === c.name);
    const cells = c.cells.map((n, idx) => {
      const isNow = m.weekStarts[idx] === currentWeek;
      if (n > 0) return `<td class="${isNow ? 'thisweek' : ''}"><span class="dot did" title="${n} walkthrough${n > 1 ? 's' : ''}">✓${n > 1 ? n : ''}</span></td>`;
      return `<td class="${isNow ? 'thisweek' : ''}"><span class="dot ${isNow ? 'pending' : 'not'}" title="${isNow ? 'not yet this week' : 'no walkthrough'}">${isNow ? '·' : '—'}</span></td>`;
    }).join('');
    return `<tr>
      <td class="nowrap"><b>${esc(c.name)}</b> <span class="muted" style="font-size:12px">${cfg ? esc(responsibilityLabel(cfg)) : ''}</span></td>
      ${cells}
      <td class="num">${c.n}</td>
      <td class="num">${c.lastWalked ? fmtDate(c.lastWalked) : '<span class="muted">never</span>'}</td>
    </tr>`;
  }).join('');

  const weeklyRows = [...m.weekly].reverse().map((w) => `<tr>
    <td class="nowrap">${esc(fmtWeek(w.week))}</td>
    <td class="num">${w.walkthroughs}</td>
    <td class="nowrap">${meter(w.unitsCovered / w.totalUnits, `${w.unitsCovered}/${w.totalUnits} floors`)}</td>
    <td>${w.coordinators.map(esc).join(', ') || '<span class="muted">—</span>'}</td>
  </tr>`).join('');

  return `
  <h1>Walkthrough completion</h1>
  <p class="sub">Who's walking, and how consistently.</p>

  <div class="tiles">
    <div class="tile"><div class="value">${m.summary.total}</div><div class="label">walkthroughs total</div></div>
    <div class="tile"><div class="value">${m.summary.withPhotos}/${m.summary.total}</div><div class="label">with photos</div></div>
  </div>

  <h2>Walkthrough streak — last ${m.weekStarts.length} weeks</h2>
  <div class="card"><table class="data streak">
    <tr><th>Coordinator</th>${streakHead}<th>Total</th><th>Last walked</th></tr>
    ${streakRows}
  </table></div>

  <h2>Floor coverage by week</h2>
  <div class="card"><table class="data">
    <tr><th>Week</th><th>Walkthroughs</th><th>Floor coverage</th><th>Who walked</th></tr>
    ${weeklyRows}
  </table></div>`;
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
