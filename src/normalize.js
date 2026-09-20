import { app } from './config.js';

const Q = app.questionMap;

/**
 * JotForm checkbox answers arrive as either an array of checked options or an
 * object like {"0": "opt", "1": "opt", "other": "free text"}.
 */
function checkboxAnswer(raw) {
  const out = { statuses: [], note: null };
  const a = raw?.answer;
  if (!a) return out;
  if (Array.isArray(a)) {
    out.statuses = a.map(String);
  } else if (typeof a === 'object') {
    for (const [k, v] of Object.entries(a)) {
      if (k === 'other') out.note = String(v).trim() || null;
      else out.statuses.push(String(v));
    }
  } else if (typeof a === 'string') {
    out.statuses = [a];
  }
  return out;
}

function firstOf(raw) {
  const a = raw?.answer;
  if (Array.isArray(a)) return a[0] ?? null;
  if (a && typeof a === 'object') return Object.values(a)[0] ?? null;
  return a ?? null;
}

function dateAnswer(raw, fallback) {
  const a = raw?.answer;
  if (a?.datetime) return a.datetime.slice(0, 10);
  if (a?.year && a?.month && a?.day) {
    return `${a.year}-${String(a.month).padStart(2, '0')}-${String(a.day).padStart(2, '0')}`;
  }
  return fallback;
}

function uploadUrls(raw) {
  let a = raw?.answer;
  if (!a) return [];
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { a = [a]; }
  }
  return (Array.isArray(a) ? a : Object.values(a)).filter((u) => typeof u === 'string' && u.startsWith('http'));
}

/** Raw JotForm submission → structured walkthrough. Returns null if unusable. */
export function normalizeSubmission(sub) {
  const ans = sub.answers || {};
  const submittedDate = (sub.created_at || '').slice(0, 10);

  const lodge = firstOf(ans[Q.lodge]);
  const floor = firstOf(ans[Q.floor]);
  const coordinator = firstOf(ans[Q.coordinator]);
  if (!lodge || !floor) return null; // incomplete/test submission

  const areas = [];
  for (const [wing, qid] of Object.entries(Q.wings)) {
    const { statuses, note } = checkboxAnswer(ans[qid]);
    if (statuses.length || note) areas.push({ area: `Wing ${wing}`, kind: 'wing', statuses, note });
  }
  for (const [section, qid] of Object.entries(Q.sections)) {
    const { statuses, note } = checkboxAnswer(ans[qid]);
    if (statuses.length || note) areas.push({ area: section, kind: 'section', statuses, note });
  }

  const photos = Q.uploads.flatMap((qid) => uploadUrls(ans[qid]));

  return {
    id: sub.id,
    submittedAt: sub.created_at,
    walkDate: dateAnswer(ans[Q.walkDate], submittedDate),
    coordinator: coordinator || 'Unknown',
    lodge,
    floor,
    comments: (typeof ans[Q.comments]?.answer === 'string' && ans[Q.comments].answer.trim()) || null,
    areas,
    photos,
  };
}
