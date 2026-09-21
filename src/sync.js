import { app } from './config.js';
import { q, hasWalkthrough, transaction, bumpDataVersion, getMeta, setMeta, db } from './db.js';
import { getAllSubmissions } from './jotform.js';
import { normalizeSubmission } from './normalize.js';
import { extractIssues, isNotApplicable } from './extract.js';
import { extractIssuesLLM, llmAvailable, llmModel } from './extract-llm.js';
import { tokens, jaccard, normKey } from './util.js';
import { warmup } from './photos.js';

/**
 * Pull submissions from JotForm and fold new ones into the local database.
 * Incremental twice over: JotForm is asked only for submissions newer than the
 * last sync (minus a 1-day overlap for safety), and already-seen ids are
 * skipped — so manual issue state (resolved/assigned) is never clobbered.
 * All writes happen in one transaction (one fsync instead of hundreds).
 */
export async function sync({ full = false, photos = true, llm = true } = {}) {
  const lastSeen = full ? null : getMeta('last_created_at');
  const since = lastSeen ? `${lastSeen.slice(0, 10)} 00:00:00` : null;
  const subs = await getAllSubmissions(app.walkthroughFormId, { sinceCreatedAt: since });
  const result = {
    fetched: subs.length, added: 0, skipped: 0,
    issuesNew: 0, issuesRecurring: 0, photosWarmed: 0,
    extractor: 'rules',
  };
  const newPhotoUrls = [];

  // Normalize the new submissions and extract their issues BEFORE the write
  // transaction — extraction may call Gemini (async, anonymized), and falls
  // back to the rule-based extractor on any failure so ingest never breaks.
  let maxCreated = lastSeen ?? '';
  const pending = [];
  for (const sub of subs) {
    if (sub.created_at > maxCreated) maxCreated = sub.created_at;
    if (sub.status === 'DELETED') continue;
    if (hasWalkthrough(sub.id)) { result.skipped++; continue; }
    const walk = normalizeSubmission(sub);
    if (!walk) { result.skipped++; continue; }
    pending.push({ sub, walk });
  }

  const useLLM = llm && llmAvailable();
  if (useLLM) result.extractor = llmModel();
  for (const p of pending) {
    p.candidates = null;
    if (useLLM) {
      try {
        p.candidates = await extractIssuesLLM(p.walk); // sequential — respects free-tier rate limits
      } catch (err) {
        console.error(`LLM extraction failed for ${p.walk.lodge} ${p.walk.floor} (${err.message}) — using rules.`);
        result.extractor = `${llmModel()} + rules fallback`;
      }
    }
    if (!p.candidates) p.candidates = extractIssues(p.walk);
  }

  const insertWalk = q(
    `INSERT INTO walkthroughs (id, submitted_at, walk_date, coordinator, lodge, floor, comments, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertArea = q(
    `INSERT INTO area_reports (walkthrough_id, area, kind, statuses_json, note, skipped)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertPhoto = q(`INSERT INTO photos (walkthrough_id, url) VALUES (?, ?)`);
  const insertIssue = q(
    `INSERT INTO issues (lodge, floor, area, description, category, severity, first_seen, last_seen, norm_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSighting = q(
    `INSERT INTO issue_sightings (issue_id, walkthrough_id, seen_date, text) VALUES (?, ?, ?, ?)`
  );
  const touchIssue = q(
    `UPDATE issues SET last_seen = MAX(last_seen, ?), occurrences = occurrences + 1 WHERE id = ?`
  );
  const openIssuesFor = q(
    `SELECT id, description FROM issues WHERE status = 'open' AND lodge = ? AND floor = ? AND area = ?`
  );
  const alreadySighted = q(
    `SELECT 1 FROM issue_sightings WHERE issue_id = ? AND walkthrough_id = ?`
  );

  // Different cube numbers are different problems, however similar the words
  // ("cube 7 needs light bulb" must never merge with "cube 1 needs light bulb").
  const cubeNums = (text) => {
    const s = new Set();
    for (const m of text.matchAll(/cubes?\s*#?\s*(\d+)/gi)) s.add(m[1]);
    return s;
  };
  const cubeConflict = (a, b) => {
    if (!a.size || !b.size) return false;
    for (const n of a) if (b.has(n)) return false;
    return true;
  };

  transaction(() => {
    for (const { sub, walk, candidates } of pending) {
      insertWalk.run(walk.id, walk.submittedAt, walk.walkDate, walk.coordinator,
        walk.lodge, walk.floor, walk.comments, JSON.stringify(sub));

      for (const a of walk.areas) {
        insertArea.run(walk.id, a.area, a.kind, JSON.stringify(a.statuses), a.note,
          isNotApplicable(a.note) ? 1 : 0);
      }
      for (const url of walk.photos) { insertPhoto.run(walk.id, url); newPhotoUrls.push(url); }

      // Extract issues and dedupe against open ones in the same lodge/floor/area.
      // Token sets for open issues are computed once per area, not per candidate.
      // An issue gains at most ONE sighting per submission ("seen N×" means N
      // separate walkthroughs), and identical repeats inside one run-on note
      // are dropped outright.
      const tokenCache = new Map();
      const seenKeys = new Set();
      for (const cand of candidates) {
        const candCubes = cubeNums(cand.description);
        // Cube numbers are part of identity — the tokenizer drops single digits,
        // so without them "cube 1 …" would look identical to "cube 7 …".
        const key = `${cand.area}|${normKey(cand.description)}|${[...candCubes].sort().join(',')}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const candTokens = tokens(cand.description);
        let open = tokenCache.get(cand.area);
        if (!open) {
          open = openIssuesFor.all(walk.lodge, walk.floor, cand.area)
            .map((r) => ({ id: r.id, tok: tokens(r.description), cubes: cubeNums(r.description) }));
          tokenCache.set(cand.area, open);
        }
        let matched = null;
        let best = 0;
        for (const row of open) {
          if (cubeConflict(candCubes, row.cubes)) continue;
          const score = jaccard(candTokens, row.tok);
          if (score > best) { best = score; matched = row; }
        }
        if (matched && best >= 0.5) {
          if (!alreadySighted.get(matched.id, walk.id)) {
            touchIssue.run(walk.walkDate, matched.id);
            insertSighting.run(matched.id, walk.id, walk.walkDate, cand.description);
            result.issuesRecurring++;
          }
        } else {
          const { lastInsertRowid } = insertIssue.run(walk.lodge, walk.floor, cand.area,
            cand.description, cand.category, cand.severity, walk.walkDate, walk.walkDate,
            normKey(cand.description));
          insertSighting.run(lastInsertRowid, walk.id, walk.walkDate, cand.description);
          open.push({ id: Number(lastInsertRowid), tok: candTokens, cubes: candCubes });
          result.issuesNew++;
        }
      }
      result.added++;
    }
    if (maxCreated) setMeta('last_created_at', maxCreated);
    if (result.added) bumpDataVersion();
  });

  if (result.added) db.exec('PRAGMA optimize');

  // Warm the photo cache (originals + thumbnails) for what we just ingested so
  // the first dashboard view is instant. Network-bound; runs after the DB work.
  if (photos && newPhotoUrls.length) {
    result.photosWarmed = await warmup(newPhotoUrls, {
      onError: (url, err) => console.error(`photo warmup failed (${err.message}): …${url.slice(-40)}`),
    });
  }

  return result;
}

// CLI entry: `npm run sync` — flags: --full (refetch everything), --no-photos, --no-llm
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const full = process.argv.includes('--full');
  const photos = !process.argv.includes('--no-photos');
  const llm = !process.argv.includes('--no-llm');
  const t0 = performance.now();
  sync({ full, photos, llm })
    .then((r) => {
      const ms = Math.round(performance.now() - t0);
      console.log(`Fetched ${r.fetched} submissions → ${r.added} new, ${r.skipped} already known (${ms} ms).`);
      console.log(`Issues: ${r.issuesNew} new, ${r.issuesRecurring} recurring (extractor: ${r.extractor}).`);
      if (photos) console.log(`Photos warmed: ${r.photosWarmed}.`);
    })
    .catch((err) => { console.error('Sync failed:', err.message); process.exit(1); });
}
