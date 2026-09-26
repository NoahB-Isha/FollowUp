import { THEMES, MODES } from '../themes.js';
import { app as appConfig } from '../config.js';
import { APP_VERSION, cmpVer } from '../version.js';
import { getUpdateState } from '../updater.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NAV = [
  ['/', 'Overview'],
  ['/issues', 'Issues'],
  ['/digest', 'Digest preview'],
];

function themePicker(theme) {
  const schemes = Object.entries(THEMES).map(([k, t]) =>
    `<option value="${k}" ${k === theme.scheme ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  const modes = MODES.map((m) =>
    `<option value="${m}" ${m === theme.mode ? 'selected' : ''}>${m === 'auto' ? 'Auto' : m === 'light' ? 'Light' : 'Dark'}</option>`).join('');
  return `<form method="post" action="/theme" class="inline theme-form" title="Color scheme">
    <select name="scheme" onchange="this.form.submit()" aria-label="Color scheme">${schemes}</select>
    <select name="mode" onchange="this.form.submit()" aria-label="Light or dark">${modes}</select>
  </form>`;
}

/** "New version" banner — apricot flair, dismissible per version (localStorage). */
function updateBanner() {
  const u = getUpdateState();
  if (!u.latest || cmpVer(u.latest, APP_VERSION) <= 0) return '';
  return `<div class="update-banner" id="fu-update" data-v="${esc(u.latest)}" hidden>
    <strong>FollowUp v${esc(u.latest)} is available</strong>
    ${u.selfUpdate
      ? '<button class="primary" id="fu-update-apply">Install &amp; restart</button>'
      : `<a class="update-dl" href="${esc(u.url)}" target="_blank" rel="noreferrer">Download the update</a>`}
    ${u.url ? `<a class="update-notes" href="${esc(u.url)}" target="_blank" rel="noreferrer">What’s new</a>` : ''}
    <button id="fu-update-skip" class="update-skip" title="Hide until the next version">✕</button>
  </div>`;
}

export function page({ title, active, body, flash, theme = { scheme: 'lilac', mode: 'auto' } }) {
  return `<!doctype html>
<html lang="en" data-scheme="${esc(theme.scheme)}"${theme.mode !== 'auto' ? ` data-mode="${esc(theme.mode)}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · FollowUp</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text y="13" font-size="13">✅</text></svg>')}">
</head>
<body>
<header>
  <span class="brand"><span class="brand-follow">Follow</span><span class="brand-up">Up</span></span>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}" ${active === href ? 'class="active"' : ''}>${label}</a>`).join('')}
  </nav>
  <span class="spacer"></span>
  ${themePicker(theme)}
  <form method="post" action="/sync" class="inline"><button class="primary" title="Pull latest submissions from JotForm">Sync now</button></form>
</header>
<main>
${updateBanner()}
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${body}
</main>
<script>
// WhatsApp buttons: open the native app (whatsapp://) and only fall back to
// the wa.me web page if nothing handled the scheme within a moment.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-app]');
  if (!a) return;
  e.preventDefault();
  let handled = false;
  const onBlur = () => { handled = true; };
  window.addEventListener('blur', onBlur, { once: true });
  location.href = a.dataset.app;
  setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    if (!handled && !document.hidden) window.open(a.href, '_blank', 'noreferrer');
  }, 1600);
});

// Update banner: hidden while dismissed for this version; Install stages the
// new bundle server-side, then polls until the restarted server answers with
// the new version and reloads.
(() => {
  const ub = document.getElementById('fu-update');
  if (!ub) return;
  let skipped = null;
  try { skipped = localStorage.getItem('fu_skip_update'); } catch {}
  if (skipped !== ub.dataset.v) ub.hidden = false;
  document.getElementById('fu-update-skip').addEventListener('click', () => {
    try { localStorage.setItem('fu_skip_update', ub.dataset.v); } catch {}
    ub.hidden = true;
  });
  const apply = document.getElementById('fu-update-apply');
  if (apply) apply.addEventListener('click', async () => {
    apply.disabled = true;
    apply.textContent = 'Installing…';
    try {
      const r = await fetch('/update/apply', { method: 'POST', headers: { 'X-FollowUp': 'update' } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'update failed');
      apply.textContent = 'Restarting…';
      const t0 = Date.now();
      (async function poll() {
        try {
          const v = await (await fetch('/api/version', { cache: 'no-store' })).json();
          if (v.version === j.version) return location.reload();
        } catch { /* server is between processes */ }
        if (Date.now() - t0 < 90000) setTimeout(poll, 1000);
        else apply.textContent = 'Taking a while — quit and reopen FollowUp';
      })();
    } catch (err) {
      apply.disabled = false;
      apply.textContent = 'Install & restart';
      ub.querySelector('strong').textContent = 'Update failed: ' + err.message;
    }
  });
})();
</script>
<footer>FollowUp v${APP_VERSION} · runs entirely on this machine · data source: JotForm “Lodge Walkthrough Checklist”${appConfig.feedback?.email
  ? ` · <a href="mailto:${esc(appConfig.feedback.email)}?subject=${encodeURIComponent('FollowUp feedback')}">💬 Send feedback</a>` : ''}</footer>
</body>
</html>`;
}
