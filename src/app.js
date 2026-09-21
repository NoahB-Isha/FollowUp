/**
 * FollowUp entrypoint — used by `npm start` in a dev checkout and as the main
 * of the packaged single-file executable. Boots the web server plus the
 * built-in scheduler (periodic sync, Monday digest, nightly DB backup), so a
 * packaged install needs no cron.
 */

// node:sqlite is flagged experimental; a packaged app can't pass --disable-warning.
const origEmit = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (text.includes('SQLite is an experimental feature')) return;
  origEmit(warning, ...args);
};

async function main() {
  // Mark packaged mode BEFORE config resolves HOME (all imports are dynamic).
  try {
    const { isSea } = await import('node:sea');
    process.__followup_sea = isSea();
  } catch { process.__followup_sea = false; }

  const { isConfigured, app: appConfig, HOME } = await import('./config.js');
  await import('./server.js');
  const { startScheduler } = await import('./scheduler.js');

  startScheduler();

  const port = Number(process.env.FOLLOWUP_PORT || appConfig.dashboardPort || 4820);
  const url = `http://localhost:${port}`;
  console.log(`FollowUp home: ${HOME}`);
  if (!isConfigured()) console.log(`Not set up yet — open ${url} and upload your setup token.`);

  // Packaged double-click UX: open the dashboard in the default browser.
  if ((process.__followup_sea || process.env.FOLLOWUP_OPEN === '1') && process.env.FOLLOWUP_OPEN !== '0') {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'darwin' ? ['open', url]
      : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url];
    setTimeout(() => {
      try { spawn(cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true }).unref(); } catch { /* headless */ }
    }, 600);
  }
}

main().catch((err) => {
  console.error('FollowUp failed to start:', err);
  process.exit(1);
});
