import { q, bumpDataVersion } from './db.js';
import { app, coverageUnits, lodges as lodgesConfig, coordinators } from './config.js';
import { today, weekStart, addDays, daysBetween, tokens, jaccard } from './util.js';

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

export function recentWalkthroughs(limit = 20, { sinceWeeks = null } = {}) {
  const since = sinceWeeks ? weekStart(addDays(today(), -7 * (sinceWeeks - 1))) : '0000-00-00';
  return q(
    `SELECT w.id, w.submitted_at, w.walk_date, w.coordinator, w.lodge, w.floor,
            (SELECT COUNT(*) FROM photos p WHERE p.walkthrough_id = w.id) photo_count,
            (SELECT COUNT(*) FROM issue_sightings s WHERE s.walkthrough_id = w.id) issue_count
     FROM walkthroughs w WHERE w.walk_date >= ? ORDER BY walk_date DESC, submitted_at DESC LIMIT ?`
  ).all(since, limit);
}

export function walkthroughCount() {
  return q(`SELECT COUNT(*) n FROM walkthroughs`).get().n;
}

/** One issue with its full sighting history (who reported it, when, exact words). */
export function issueDetail(id) {
  const issue = q(`SELECT * FROM issues WHERE id = ?`).get(id);
  if (!issue) return null;
  const sightings = q(
    `SELECT s.seen_date, s.text, s.walkthrough_id, w.coordinator
     FROM issue_sightings s LEFT JOIN walkthroughs w ON w.id = s.walkthrough_id
     WHERE s.issue_id = ? ORDER BY s.seen_date DESC`
  ).all(id);
  return { issue, sightings };
}

/**
 * Issues (any status, any lodge) that look like this one — surfaces recurring
 * themes like "water dispenser" problems that keep coming back in different
 * places or under already-resolved entries. Wording overlap is the base score;
 * sharing a specific equipment/supply area (or naming it in the text) counts
 * heavily, since "please clean" and "needs service" on the same dispenser are
 * the same story told twice.
 */
const SPECIFIC_AREAS = new Set(['Water dispenser', 'Cleaning supplies', 'Cleaning solutions', 'Paper products', 'Maintenance']);

export function similarIssues(issue, { threshold = 0.28, limit = 8 } = {}) {
  const targetDesc = tokens(issue.description);
  const targetAreaTok = [...tokens(issue.area)];
  const rows = q(`SELECT id, lodge, floor, area, description, category, status,
                         first_seen, last_seen, occurrences FROM issues WHERE id != ?`).all(issue.id);
  return rows
    .map((r) => {
      const rDesc = tokens(r.description);
      let score = jaccard(targetDesc, rDesc);
      const rAreaTok = [...tokens(r.area)];
      if (SPECIFIC_AREAS.has(issue.area) && (r.area === issue.area || targetAreaTok.every((t) => rDesc.has(t)))) {
        score += 0.4;
      } else if (SPECIFIC_AREAS.has(r.area) && rAreaTok.every((t) => targetDesc.has(t))) {
        score += 0.4;
      }
      return { ...r, score };
    })
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
 * Walkthrough-completion picture: who is walking, how consistently, shown as
 * a coordinator × week streak grid plus a weekly floor-coverage rollup.
 */
export function completionMetrics() {
  const walks = q(
    `SELECT w.id, w.coordinator, w.lodge, w.floor, w.walk_date,
            (SELECT COUNT(*) FROM photos p WHERE p.walkthrough_id = w.id) photo_count
     FROM walkthroughs w ORDER BY walk_date DESC, submitted_at DESC`
  ).all();

  const weeks = app.coverageWeeks;
  const start = weekStart(addDays(today(), -7 * (weeks - 1)));
  const weekStarts = [];
  for (let i = 0; i < weeks; i++) weekStarts.push(addDays(start, i * 7));
  const totalUnits = coverageUnits().length;

  // Weekly rollup over the coverage window.
  const weekly = weekStarts.map((ws) => {
    const inWeek = walks.filter((w) => weekStart(w.walk_date) === ws);
    return {
      week: ws,
      walkthroughs: inWeek.length,
      unitsCovered: new Set(inWeek.map((w) => `${w.lodge}|${w.floor}`)).size,
      totalUnits,
      coordinators: [...new Set(inWeek.map((w) => w.coordinator))],
    };
  });

  // Streak grid: config order first, then any unexpected submitters.
  const names = coordinators.coordinators.map((c) => c.name);
  for (const w of walks) if (!names.includes(w.coordinator)) names.push(w.coordinator);
  const streak = names.map((name) => {
    const mine = walks.filter((w) => w.coordinator === name);
    return {
      name,
      n: mine.length,
      lastWalked: mine[0]?.walk_date ?? null,
      avgPhotos: mine.length ? mine.reduce((s, w) => s + w.photo_count, 0) / mine.length : 0,
      cells: weekStarts.map((ws) => mine.filter((w) => weekStart(w.walk_date) === ws).length),
    };
  });

  return {
    weekStarts,
    weekly,
    streak,
    summary: {
      total: walks.length,
      withPhotos: walks.filter((w) => w.photo_count > 0).length,
    },
  };
}

export function setIssueStatus(id, status, by) {
  const resolvedAt = status === 'open' ? null : today();
  q(`UPDATE issues SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`)
    .run(status, resolvedAt, status === 'open' ? null : by || null, id);
  bumpDataVersion();
}

