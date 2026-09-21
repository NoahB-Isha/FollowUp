import { q, bumpDataVersion } from './db.js';
import { app, coverageUnits, lodges as lodgesConfig, coordinators, wingInfo } from './config.js';
import { today, weekStart, addDays, daysBetween, median } from './util.js';

export function stats() {
  const open = q(`SELECT COUNT(*) n FROM issues WHERE status='open'`).get().n;
  const high = q(`SELECT COUNT(*) n FROM issues WHERE status='open' AND severity='high'`).get().n;
  const thisWeek = q(`SELECT COUNT(*) n FROM walkthroughs WHERE walk_date >= ?`).get(weekStart(today())).n;
  const resolved30 = q(`SELECT COUNT(*) n FROM issues WHERE status='resolved' AND resolved_at >= ?`)
    .get(addDays(today(), -30)).n;
  return { open, high, thisWeek, resolved30 };
}

/**
 * Coverage grid: rows = lodge×floor units, columns = last N ISO weeks.
 * Single pass over the rows (no per-unit/per-cell queries).
 */
export function coverage(weeks = app.coverageWeeks) {
  const start = weekStart(addDays(today(), -7 * (weeks - 1)));
  const weekStarts = [];
  for (let i = 0; i < weeks; i++) weekStarts.push(addDays(start, i * 7));
  const weekIndex = new Map(weekStarts.map((ws, i) => [ws, i]));

  // One query for the window, one for all-time latest per unit.
  const rows = q(
    `SELECT id, lodge, floor, walk_date, coordinator FROM walkthroughs WHERE walk_date >= ? ORDER BY walk_date`
  ).all(start);
  const lastMap = new Map(
    q(`SELECT lodge, floor, MAX(walk_date) d FROM walkthroughs GROUP BY lodge, floor`).all()
      .map((r) => [`${r.lodge}|${r.floor}`, r.d])
  );

  const units = coverageUnits().map((u) => ({
    ...u,
    cells: weekStarts.map((ws) => ({ week: ws, walks: [] })),
    lastWalked: lastMap.get(`${u.lodge}|${u.floor}`) ?? null,
  }));
  const unitMap = new Map(units.map((u) => [`${u.lodge}|${u.floor}`, u]));

  for (const r of rows) {
    const unit = unitMap.get(`${r.lodge}|${r.floor}`);
    const idx = weekIndex.get(weekStart(r.walk_date));
    if (unit && idx !== undefined) unit.cells[idx].walks.push(r);
  }
  for (const u of units) u.staleDays = u.lastWalked ? daysBetween(u.lastWalked, today()) : null;
  return { weekStarts, units };
}

export function openIssues({ lodge, category, severity, q: text } = {}) {
  const where = [`status = 'open'`];
  const params = [];
  if (lodge) { where.push('lodge = ?'); params.push(lodge); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (severity) { where.push('severity = ?'); params.push(severity); }
  if (text) { where.push('description LIKE ?'); params.push(`%${text}%`); }
  return q(
    `SELECT * FROM issues WHERE ${where.join(' AND ')}
     ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, first_seen ASC`
  ).all(...params);
}

export function issueAge(issue) {
  return daysBetween(issue.first_seen, today());
}

/** Latest walkthrough date per lodge+floor — used to flag "not seen lately". */
export function latestWalkDates() {
  const rows = q(`SELECT lodge, floor, MAX(walk_date) d FROM walkthroughs GROUP BY lodge, floor`).all();
  return new Map(rows.map((r) => [`${r.lodge}|${r.floor}`, r.d]));
}

export function recentWalkthroughs(limit = 20) {
  return q(
    `SELECT w.id, w.submitted_at, w.walk_date, w.coordinator, w.lodge, w.floor,
            (SELECT COUNT(*) FROM photos p WHERE p.walkthrough_id = w.id) photo_count,
            (SELECT COUNT(*) FROM issue_sightings s WHERE s.walkthrough_id = w.id) issue_count
     FROM walkthroughs w ORDER BY walk_date DESC, submitted_at DESC LIMIT ?`
  ).all(limit);
}

export function walkthroughDetail(id) {
  const walk = q(`SELECT * FROM walkthroughs WHERE id = ?`).get(id);
  if (!walk) return null;
  const areas = q(`SELECT * FROM area_reports WHERE walkthrough_id = ? ORDER BY kind DESC, area`).all(id);
  const photos = q(`SELECT * FROM photos WHERE walkthrough_id = ?`).all(id);
  const sightings = q(
    `SELECT s.text, s.seen_date, i.* FROM issue_sightings s JOIN issues i ON i.id = s.issue_id
     WHERE s.walkthrough_id = ? ORDER BY i.area`
  ).all(id);
  return { walk, areas, photos, sightings };
}

/**
 * Per-lodge health rollup for the Dormitory Health cards.
 * critical = open high-severity issues; warning = open issues or stale/never
 * coverage on any floor; good = clean and recently walked.
 */
export function lodgeHealth() {
  const openRows = q(
    `SELECT lodge, COUNT(*) n, SUM(severity = 'high') high FROM issues WHERE status = 'open' GROUP BY lodge`
  ).all();
  const openMap = new Map(openRows.map((r) => [r.lodge, r]));
  const last = latestWalkDates();

  return lodgesConfig.lodges.map((lodge) => {
    const floors = Object.keys(lodgesConfig.floors).map((floor) => {
      const d = last.get(`${lodge}|${floor}`) ?? null;
      return { floor, lastWalked: d, staleDays: d ? daysBetween(d, today()) : null };
    });
    const open = openMap.get(lodge)?.n ?? 0;
    const high = openMap.get(lodge)?.high ?? 0;
    const stale = floors.some((f) => f.staleDays == null || f.staleDays > app.staleAfterDays);
    const status = high > 0 ? 'critical' : open > 0 || stale ? 'warning' : 'good';
    return { lodge, label: lodgesConfig.labels?.[lodge] ?? '', open, high, floors, stale, status };
  });
}

/** Walkthroughs completed this ISO week, grouped by coordinator name. */
export function weeklyWalkStatus() {
  const ws = weekStart(today());
  const rows = q(
    `SELECT id, coordinator, lodge, floor, walk_date FROM walkthroughs WHERE walk_date >= ? ORDER BY walk_date`
  ).all(ws);
  const byCoord = new Map();
  for (const r of rows) {
    if (!byCoord.has(r.coordinator)) byCoord.set(r.coordinator, []);
    byCoord.get(r.coordinator).push(r);
  }
  return { weekStart: ws, byCoord };
}

/** Latest walkthrough (date + coordinator) per floor of one lodge. */
export function lodgeFloorWalks(lodge) {
  const rows = q(
    `SELECT floor, walk_date, coordinator FROM walkthroughs WHERE lodge = ? ORDER BY walk_date DESC`
  ).all(lodge);
  const perFloor = new Map();
  for (const r of rows) if (!perFloor.has(r.floor)) perFloor.set(r.floor, r);
  return perFloor;
}

export function lodgeWalkthroughs(lodge, limit = 12) {
  return q(
    `SELECT w.id, w.submitted_at, w.walk_date, w.coordinator, w.lodge, w.floor,
            (SELECT COUNT(*) FROM photos p WHERE p.walkthrough_id = w.id) photo_count,
            (SELECT COUNT(*) FROM issue_sightings s WHERE s.walkthrough_id = w.id) issue_count
     FROM walkthroughs w WHERE w.lodge = ? ORDER BY walk_date DESC, submitted_at DESC LIMIT ?`
  ).all(lodge, limit);
}

/**
 * Form-completion metrics: how thoroughly, consistently, and promptly the
 * walkthrough form is being filled out. A walkthrough's completeness is the
 * share of expected parts answered: the floor's inspectable wings (a wing
 * marked N/A counts as answered — the coordinator responded) plus the six
 * fixed sections. Submit lag = days between the reported walk date and the
 * actual submission.
 */
export function completionMetrics() {
  const sectionNames = Object.keys(app.questionMap.sections);
  const walks = q(
    `SELECT w.id, w.coordinator, w.lodge, w.floor, w.walk_date, w.submitted_at, w.comments,
            (SELECT COUNT(*) FROM photos p WHERE p.walkthrough_id = w.id) photo_count
     FROM walkthroughs w ORDER BY walk_date DESC, submitted_at DESC`
  ).all();
  const answeredByWalk = new Map();
  for (const r of q(`SELECT walkthrough_id, area FROM area_reports`).all()) {
    if (!answeredByWalk.has(r.walkthrough_id)) answeredByWalk.set(r.walkthrough_id, new Set());
    answeredByWalk.get(r.walkthrough_id).add(r.area);
  }

  const perWalk = walks.map((w) => {
    const answered = answeredByWalk.get(w.id) ?? new Set();
    const wings = (lodgesConfig.floors[w.floor] ?? []).filter((x) => wingInfo(w.lodge, x).inspect);
    const wingsDone = wings.filter((x) => answered.has(`Wing ${x}`)).length;
    const sectionsDone = sectionNames.filter((s) => answered.has(s)).length;
    const expected = wings.length + sectionNames.length;
    const submittedDate = (w.submitted_at || '').slice(0, 10) || w.walk_date;
    return {
      ...w,
      wingsDone, wingsExpected: wings.length,
      sectionsDone, sectionsExpected: sectionNames.length,
      completeness: expected ? (wingsDone + sectionsDone) / expected : 1,
      lag: daysBetween(w.walk_date, submittedDate),
      hasComments: !!w.comments,
    };
  });

  // Weekly rollup over the coverage window.
  const weeks = app.coverageWeeks;
  const start = weekStart(addDays(today(), -7 * (weeks - 1)));
  const totalUnits = coverageUnits().length;
  const weekly = [];
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(start, i * 7);
    const inWeek = perWalk.filter((w) => weekStart(w.walk_date) === ws);
    weekly.push({
      week: ws,
      walkthroughs: inWeek.length,
      unitsCovered: new Set(inWeek.map((w) => `${w.lodge}|${w.floor}`)).size,
      totalUnits,
      coordinators: [...new Set(inWeek.map((w) => w.coordinator))],
      avgCompleteness: inWeek.length
        ? inWeek.reduce((s, w) => s + w.completeness, 0) / inWeek.length : null,
    });
  }

  // Per-coordinator rollup — config order first, then any unexpected submitters.
  const names = coordinators.coordinators.map((c) => c.name);
  for (const w of perWalk) if (!names.includes(w.coordinator)) names.push(w.coordinator);
  const currentWeek = weekStart(today());
  const perCoordinator = names.map((name) => {
    const mine = perWalk.filter((w) => w.coordinator === name);
    if (!mine.length) return { name, n: 0 };
    const first = mine[mine.length - 1].walk_date;
    const weeksSpan = Math.floor(daysBetween(weekStart(first), currentWeek) / 7) + 1;
    const weeksActive = new Set(mine.map((w) => weekStart(w.walk_date))).size;
    return {
      name,
      n: mine.length,
      lastWalked: mine[0].walk_date,
      weeksActive,
      weeksSpan,
      avgCompleteness: mine.reduce((s, w) => s + w.completeness, 0) / mine.length,
      medianLag: median(mine.map((w) => w.lag)),
      avgPhotos: mine.reduce((s, w) => s + w.photo_count, 0) / mine.length,
    };
  });

  // Which form parts get skipped.
  const sectionRates = sectionNames.map((s) => ({
    section: s,
    filled: perWalk.filter((w) => (answeredByWalk.get(w.id) ?? new Set()).has(s)).length,
    total: perWalk.length,
  }));
  const wingTotals = perWalk.reduce(
    (acc, w) => ({ done: acc.done + w.wingsDone, expected: acc.expected + w.wingsExpected }),
    { done: 0, expected: 0 }
  );

  return {
    perWalk,
    weekly,
    perCoordinator,
    sectionRates,
    wingTotals,
    summary: {
      total: perWalk.length,
      avgCompleteness: perWalk.length
        ? perWalk.reduce((s, w) => s + w.completeness, 0) / perWalk.length : 0,
      medianLag: median(perWalk.map((w) => w.lag)),
      withPhotos: perWalk.filter((w) => w.photo_count > 0).length,
    },
  };
}

export function setIssueStatus(id, status, by) {
  const resolvedAt = status === 'open' ? null : today();
  q(`UPDATE issues SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`)
    .run(status, resolvedAt, status === 'open' ? null : by || null, id);
  bumpDataVersion();
}

