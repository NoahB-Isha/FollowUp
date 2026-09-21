import { THEMES, MODES } from '../themes.js';

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

export function page({ title, active, body, flash, theme = { scheme: 'sunrise', mode: 'auto' } }) {
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
  <span class="brand">FollowUp</span>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}" ${active === href ? 'class="active"' : ''}>${label}</a>`).join('')}
  </nav>
  <span class="spacer"></span>
  ${themePicker(theme)}
  <form method="post" action="/sync" class="inline"><button class="primary" title="Pull latest submissions from JotForm">Sync now</button></form>
</header>
<main>
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${body}
</main>
<footer>FollowUp runs entirely on this machine · data source: JotForm “Lodge Walkthrough Checklist”</footer>
</body>
</html>`;
}
