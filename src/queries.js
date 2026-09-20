import { q, bumpDataVersion } from './db.js';
import { app, coverageUnits } from './config.js';
import { today, weekStart, addDays, daysBetween } from './util.js';

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

export function openIssues({ lodge, category, severity, assignee, q: text } = {}) {
  const where = [`status = 'open'`];
  const params = [];
  if (lodge) { where.push('lodge = ?'); params.push(lodge); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (severity) { where.push('severity = ?'); params.push(severity); }
  if (assignee) { where.push('assignee = ?'); params.push(assignee); }
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

export function setIssueStatus(id, status, by) {
  const resolvedAt = status === 'open' ? null : today();
  q(`UPDATE issues SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`)
    .run(status, resolvedAt, status === 'open' ? null : by || null, id);
  bumpDataVersion();
}

export function assignIssue(id, assignee) {
  q(`UPDATE issues SET assignee = ? WHERE id = ?`).run(assignee || null, id);
  bumpDataVersion();
}
