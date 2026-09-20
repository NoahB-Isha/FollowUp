# FollowUp

Aggregates JotForm **Lodge Walkthrough Checklist** submissions into actionable
task lists, a coordinator dashboard, and weekly digest emails — so overall
coordinators can see what's getting done and where to follow up.

Built to run **entirely on-campus** (e.g. Madhu's laptop). No cloud hosting, no
external services: the only network calls are HTTPS to `api.jotform.com` (and
your SMTP relay when sending digests). The API key never leaves the machine and
is never exposed to the browser.

## Quick start

```bash
npm install
cp .env.example .env        # then fill in JOTFORM_API_KEY
npm run sync                # pull submissions into data/followup.db
npm run warm                # one-time: pre-download photos + build thumbnails
npm run serve               # dashboard at http://localhost:4820
```

## What it does

1. **Sync** (`npm run sync`) — pulls all form submissions, normalizes them
   (lodge / floor / wing / sections), and extracts discrete **issues** from the
   free-text notes using rule-based keyword extraction. Issues are deduped
   across walkthroughs: "fans dirty" reported two weeks in a row becomes one
   issue seen 2×, not two issues. Incremental and safe to re-run (cron it).
2. **Dashboard** (`npm run serve`, localhost only) —
   - **Overview**: stat tiles, a lodge × floor **coverage grid** for the last 6
     weeks (who walked what, which floors are overdue or have *never* been
     walked), longest-open issues, recent walkthroughs.
   - **Issues**: filter by lodge / category / severity / assignee, assign to a
     coordinator, mark resolved or dismissed. A "✓? not seen" hint flags issues
     that didn't come up in the latest walkthrough of that floor.
   - **Walkthroughs**: every submission with its raw checklist, extracted
     issues, and photos (proxied through the server so the API key stays local).
   - **Digest preview**: exactly what each coordinator's weekly email will say.
3. **Weekly digest** (`npm run digest`) — writes per-coordinator HTML digests to
   `data/digests/<date>/` (dry run). `npm run digest:send` emails them via the
   SMTP settings in `.env`. Content: open issues (scoped to the coordinator's
   assigned lodges if set in `config/coordinators.json`), items assigned to
   them, this week's coverage and gaps, aging issues.

## Weekly cron on the laptop

```cron
# Sync every morning at 7; digest Mondays at 7:30
0 7 * * *  cd /path/to/FollowUp && npm run --silent sync
30 7 * * 1 cd /path/to/FollowUp && npm run --silent digest:send
```

(Or use `launchd` on macOS for laptops that sleep; run `crontab -e` to install.)

## Configuration

| File | What's in it |
|---|---|
| `.env` | JotForm API key, SMTP settings, optional dashboard token. **Never committed.** |
| `config/app.json` | Form ID and the question-ID map (update if the form is restructured), staleness thresholds. |
| `config/lodges.json` | The four lodges, floor → wing layout, and non-dorm wings (wellness office, sadhana room, film room) so they don't count as coverage gaps. |
| `config/coordinators.json` | Coordinator names (must match the form dropdown), emails, optional `assignedLodges` to scope digests. |

## Architecture & security

```
JotForm API ──sync──▶ SQLite (data/followup.db, local disk)
                         │
             ┌───────────┴───────────┐
      Express dashboard        weekly digest
      (127.0.0.1 only)         (SMTP or dry-run HTML)
      HTML views + /api/* JSON
```

- **Node 22+, two dependencies** (`express`, `nodemailer`); SQLite is Node's
  built-in — small, auditable surface.
- Dashboard binds to `127.0.0.1`. Photos are fetched server-side and cached in
  `data/photocache/` so the browser never sees the API key.
- All walkthrough data stays in `data/` (gitignored).
- Issue extraction is **rule-based on purpose** — no data leaves campus. The
  extractor is one module (`src/extract.js`); a local LLM (e.g. Ollama) can be
  swapped in later without touching the pipeline.

### Performance notes

Tuned to stay snappy on a laptop or a Pi, with zero added dependencies:

- **Thumbnails**: multi-MB iPhone photos are resized once with macOS's built-in
  `sips` (~30 KB each, 480px) and served with immutable cache headers; a
  photo-heavy page dropped from ~70 MB to ~1 MB. `npm run sync` warms new
  photos automatically; `npm run warm` backfills. On non-macOS the original is
  served until a resizer is added.
- **Gzip** for HTML/JSON via `node:zlib` (the issues page is ~21× smaller).
- **Version-keyed response cache**: every write bumps a data version (in the
  DB, so CLI writes count too); unchanged pages are served from memory and any
  change invalidates instantly.
- **SQLite**: WAL + `synchronous=NORMAL`, mmap, prepared-statement cache, and
  sync ingests everything in **one transaction**.
- **Incremental sync**: JotForm is only asked for submissions newer than the
  last sync (1-day overlap for safety). `npm run sync -- --full` refetches all.

## Phase 2: Pi + iPhone (already accounted for)

The dashboard's data lives behind `/api/*` JSON endpoints (`/api/issues`,
`/api/coverage`, `/api/walkthroughs`…). To move off the laptop:

1. Copy this folder to a Pi on the campus network, run `sync` + `serve` under
   `systemd`, and set `FOLLOWUP_TOKEN` in `.env` — the token gate turns on
   automatically and the listen address can be widened then.
2. A TestFlight app (or a home-screen web clip, which needs zero App Store
   work) talks to those same endpoints on the campus LAN.

## Roadmap ideas

- Per-coordinator lodge assignments driving rotation ("Hickory 2nd hasn't been
  walked — it's your week").
- Auto-close hints → one-tap confirm when an issue stops appearing.
- Photo ↔ issue linking (photos are currently per-walkthrough).
- Track the "maintenance issues reported" loop against actual work orders.
