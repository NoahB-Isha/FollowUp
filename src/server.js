import express from 'express';
import { gzipSync, constants as zc } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app as appConfig, coordinators, lodges } from './config.js';
import { dataVersion } from './db.js';
import { sync } from './sync.js';
import { ensureOriginal, ensureThumb } from './photos.js';
import {
  stats, coverage, openIssues, recentWalkthroughs,
  walkthroughDetail, setIssueStatus,
  lodgeHealth, weeklyWalkStatus, lodgeFloorWalks, lodgeWalkthroughs, completionMetrics,
  issueDetail, similarIssues,
} from './queries.js';
import { verifyToken } from './links.js';
import { buildThemeCss, THEMES, MODES } from './themes.js';
import { buildDigest } from './digest.js';
import { page } from './web/layout.js';
import * as pages from './web/pages.js';
import { today, weekStart, addDays } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const server = express();
server.use(express.urlencoded({ extended: false }));

// ---------- Theme (scheme + light/dark mode), persisted in a cookie ----------
server.use((req, res, next) => {
  const m = /(?:^|;\s*)fu_theme=([\w-]+)\.([\w-]+)/.exec(req.headers.cookie || '');
  req.theme = {
    scheme: THEMES[m?.[1]] ? m[1] : 'lilac',
    mode: MODES.includes(m?.[2]) ? m[2] : 'auto',
  };
  next();
});

server.post('/theme', (req, res) => {
  const scheme = THEMES[req.body.scheme] ? req.body.scheme : 'lilac';
  const mode = MODES.includes(req.body.mode) ? req.body.mode : 'auto';
  res.set('Set-Cookie', `fu_theme=${scheme}.${mode}; Path=/; Max-Age=31536000; SameSite=Lax`);
  res.redirect(req.get('referer') || '/');
});

// Optional shared token — for when this moves from a laptop to a shared Pi.
const TOKEN = process.env.FOLLOWUP_TOKEN;
server.use((req, res, next) => {
  if (!TOKEN) return next();
  // Magic links carry their own signed authorization; assets are harmless.
  if (req.path.startsWith('/r/') || req.path === '/styles.css' || req.path.startsWith('/fonts/')) return next();
  if (req.query.token === TOKEN) {
    res.cookie?.('fu', TOKEN);
    return next();
  }
  if ((req.headers.cookie || '').includes(`fu=${TOKEN}`)) return next();
  res.status(401).send('FollowUp: add ?token=… to the URL (ask the overall coordinator).');
});

// ---------- Perf: gzip text responses (zero-dep, node:zlib) ----------
// Level 1 ("best speed") still shrinks our repetitive HTML ~15×, in <1 ms.
server.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const send = res.send.bind(res);
  res.send = (body) => {
    if (res.headersSent || (typeof body !== 'string' && !Buffer.isBuffer(body))) return send(body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (buf.length < 1024) return send(body);
    if (typeof body === 'string' && !res.get('Content-Type')) res.type('html');
    const gz = gzipSync(buf, { level: zc.Z_BEST_SPEED });
    if (gz.length >= buf.length) return send(body);
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return send(gz);
  };
  next();
});

// ---------- Perf: response cache keyed on data version ----------
// Rendering is cheap but not free; repeat views of an unchanged dashboard are
// served straight from memory. Any write (sync/resolve/assign — even from the
// CLI in another process) bumps the version and invalidates everything at once.
const rcache = new Map(); // originalUrl → { key, body, type }
const RCACHE_MAX = 300;
function cachedGet(handler) {
  return (req, res) => {
    // date in key: "n days open" labels roll over at midnight; theme in key: pages embed it
    const key = `${today()}|${dataVersion()}|${req.theme.scheme}.${req.theme.mode}`;
    const hit = rcache.get(req.originalUrl);
    if (hit && hit.key === key) {
      res.type(hit.type);
      return res.send(hit.body);
    }
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && res.statusCode === 200) {
        if (rcache.size >= RCACHE_MAX) rcache.delete(rcache.keys().next().value);
        rcache.set(req.originalUrl, { key, body, type: res.get('Content-Type') || 'text/html; charset=utf-8' });
      }
      return send(body);
    };
    handler(req, res);
  };
}

// ---------- Static: CSS from memory with revalidation ----------
// Theme tokens are generated per scheme × mode; the structural stylesheet follows.
const CSS = buildThemeCss() + readFileSync(path.join(__dirname, 'web/styles.css'), 'utf8');
server.get('/styles.css', (req, res) => {
  res.set('Cache-Control', 'no-cache'); // ETag (automatic) makes revalidation a 304
  res.type('text/css').send(CSS);
});

// Self-hosted fonts — no external requests from the browser, works offline.
server.use('/fonts', express.static(path.join(__dirname, 'web/fonts'), {
  maxAge: 365 * 24 * 3600 * 1000, immutable: true, fallthrough: false,
}));

// Coordinator profile photos (optional) — drop <Name>.jpg into src/web/avatars.
server.use('/avatars', express.static(path.join(__dirname, 'web/avatars'), {
  maxAge: 24 * 3600 * 1000,
}));

// ---------- HTML pages ----------

server.get('/', cachedGet((req, res) => {
  const wkStart = weekStart(today());
  const twoWeeksAgo = addDays(today(), -14);
  const open = openIssues({});
  const body = pages.overviewBody({
    s: stats(),
    health: lodgeHealth(),
    weekly: weeklyWalkStatus(),
    streakMetrics: completionMetrics(),
    weekIssues: open.filter((i) => i.last_seen >= wkStart),
    longTerm: open.filter((i) => i.first_seen <= twoWeeksAgo).slice(0, 10),
  });
  res.send(page({ theme: req.theme, title: 'Overview', active: '/', body, flash: req.query.flash }));
}));

server.get('/lodges/:lodge', cachedGet((req, res) => {
  const health = lodgeHealth().find((h) => h.lodge === req.params.lodge);
  if (!health) return res.status(404).send(page({ theme: req.theme, title: 'Not found', body: '<p>Unknown lodge.</p>' }));
  const issues = openIssues({ lodge: health.lodge })
    .sort((a, b) => a.area.localeCompare(b.area) || (a.severity === 'high' ? -1 : 1));
  res.send(page({ theme: req.theme,
    title: health.lodge, active: '/',
    body: pages.lodgeBody({
      health,
      issues,
      floorWalks: lodgeFloorWalks(health.lodge),
      walks: lodgeWalkthroughs(health.lodge),
      cov: coverage(),
    }),
    flash: req.query.flash,
  }));
}));

server.get('/issues', cachedGet((req, res) => {
  const filters = {
    lodge: req.query.lodge || '', category: req.query.category || '',
    severity: req.query.severity || '', q: req.query.q || '',
  };
  const body = pages.issuesBody({
    issues: openIssues(filters),
    filters,
    lodgesList: lodges.lodges,
  });
  res.send(page({ theme: req.theme, title: 'Issues', active: '/issues', body, flash: req.query.flash }));
}));

// Retired list pages — walkthrough details live on, linked from lodge pages.
server.get('/walkthroughs', (req, res) => res.redirect('/'));
server.get('/completion', (req, res) => res.redirect('/'));

server.get('/issue/:id', cachedGet((req, res) => {
  const detail = issueDetail(Number(req.params.id));
  if (!detail) return res.status(404).send(page({ theme: req.theme, title: 'Not found', body: '<p>Issue not found.</p>' }));
  res.send(page({ theme: req.theme,
    title: `Issue — ${detail.issue.lodge}`, active: '/issues',
    body: pages.issueDetailBody({
      ...detail,
      similar: similarIssues(detail.issue),
    }),
  }));
}));

server.get('/walkthroughs/:id', cachedGet((req, res) => {
  const detail = walkthroughDetail(req.params.id);
  if (!detail) return res.status(404).send(page({ theme: req.theme, title: 'Not found', body: '<p>Walkthrough not found. Try Sync.</p>' }));
  res.send(page({ theme: req.theme,
    title: `${detail.walk.lodge} ${detail.walk.floor}`, active: '/walkthroughs',
    body: pages.walkthroughDetailBody(detail),
  }));
}));

server.get('/digest', cachedGet((req, res) => {
  const names = coordinators.coordinators.filter((c) => c.digest !== false).map((c) => c.name);
  const selected = names.includes(req.query.who) ? req.query.who : names[0];
  const c = coordinators.coordinators.find((x) => x.name === selected);
  const { html } = buildDigest(c);
  res.send(page({ theme: req.theme, title: 'Digest', active: '/digest', body: pages.digestBody({ names, selected, html }) }));
}));

// ---------- Actions ----------

server.post('/sync', async (req, res) => {
  try {
    const r = await sync();
    res.redirect(`/?flash=${encodeURIComponent(`Synced: ${r.added} new walkthroughs, ${r.issuesNew} new issues, ${r.issuesRecurring} recurring.`)}`);
  } catch (err) {
    res.redirect(`/?flash=${encodeURIComponent('Sync failed: ' + err.message)}`);
  }
});

server.post('/issues/:id/status', (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.body.status) ? req.body.status : 'open';
  setIssueStatus(Number(req.params.id), status, req.body.by || 'dashboard');
  res.redirect(req.get('referer') || '/issues');
});

// ---------- Magic links: check an issue off from any phone ----------
// GET shows a confirm page (so email/WhatsApp link prefetchers can't resolve
// things by accident); POST does the deed. The signed token is the auth.

server.get('/r/:token', (req, res) => {
  const id = verifyToken(req.params.token);
  const detail = id && issueDetail(id);
  if (!detail) return res.status(404).send(page({ theme: req.theme, title: 'Invalid link', body: '<p style="text-align:center">This link isn’t valid — it may be from an older message.</p>' }));
  res.send(page({ theme: req.theme, title: 'Check off', body: pages.magicConfirmBody({ issue: detail.issue, token: req.params.token }) }));
});

server.post('/r/:token', (req, res) => {
  const id = verifyToken(req.params.token);
  const detail = id && issueDetail(id);
  if (!detail) return res.status(404).send(page({ theme: req.theme, title: 'Invalid link', body: '<p style="text-align:center">This link isn’t valid.</p>' }));
  if (req.query.undo === '1') {
    setIssueStatus(id, 'open');
    return res.send(page({ theme: req.theme, title: 'Reopened', body: pages.magicConfirmBody({ issue: issueDetail(id).issue, token: req.params.token }) }));
  }
  setIssueStatus(id, 'resolved', 'magic-link');
  res.send(page({ theme: req.theme, title: 'Done', body: pages.magicDoneBody({ issue: issueDetail(id).issue, token: req.params.token }) }));
});

// ---------- Photo serving (key stays server-side; cached + immutable) ----------
// ?s=t serves a ~40 KB thumbnail instead of the multi-MB original.
const YEAR = 365 * 24 * 3600 * 1000;
server.get('/photo', async (req, res) => {
  const url = String(req.query.u || '');
  try {
    const file = req.query.s === 't' ? await ensureThumb(url) : await ensureOriginal(url);
    res.sendFile(file, { maxAge: YEAR, immutable: true, lastModified: false });
  } catch {
    // Could not fetch with the API key — fall back to the original URL
    // (works when the viewer is logged in to JotForm in their browser).
    try { res.redirect(new URL(url).href); } catch { res.status(400).send('bad photo url'); }
  }
});

// ---------- JSON API (same data, for a future iPhone/TestFlight client) ----------

server.get('/api/stats', cachedGet((req, res) => res.json(stats())));
server.get('/api/coverage', cachedGet((req, res) => res.json(coverage())));
server.get('/api/issues', cachedGet((req, res) => res.json(openIssues(req.query))));
server.get('/api/walkthroughs', cachedGet((req, res) => res.json(recentWalkthroughs(500))));
server.get('/api/walkthroughs/:id', cachedGet((req, res) => {
  const d = walkthroughDetail(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
}));

const port = Number(process.env.FOLLOWUP_PORT || appConfig.dashboardPort || 4820);
server.listen(port, '127.0.0.1', () => {
  console.log(`FollowUp dashboard → http://localhost:${port} (local machine only)`);
});
