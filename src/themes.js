/**
 * Color schemes. Each theme defines light AND dark token sets; the dark set is
 * hand-picked, not an automatic inversion. Scheme + mode are chosen from the
 * header (cookie-persisted); mode "auto" follows the OS.
 *
 * - lilac:   the default — #fefcff porcelain with the brand blue/purple,
 *            #ffa74c apricot as its warm attention color
 * - sunrise: the original warm orange-cream
 * - ember:   inspired by the StarAdmin palette (#F29F67 / #1E1E2C)
 * - skydash: inspired by the Skydash palette (#4B49AC / #98BDFF / #F3797E)
 *
 * Optional per-theme `warning` overrides the global attention color (due/
 * pending cells, open-status chip, row hover tint, supplies chip).
 */

export const THEMES = {
  sunrise: {
    label: 'Sunrise',
    light: {
      page: '#f9f0e4', surface: '#fffdf9',
      ink: '#241c12', ink2: '#5d5245', muted: '#97897a',
      hairline: '#eee0cf', border: 'rgba(95, 62, 24, 0.13)',
      accent: '#2a78d6', accentInk: '#ffffff', goodText: '#006300',
      shadowSm: '0 1px 2px rgba(99,62,18,0.06), 0 3px 10px rgba(99,62,18,0.08)',
      shadowMd: '0 3px 6px rgba(99,62,18,0.08), 0 10px 26px rgba(99,62,18,0.14)',
    },
    dark: {
      page: '#181209', surface: '#231b10',
      ink: '#fdf6ec', ink2: '#d3c6b4', muted: '#998c7c',
      hairline: '#392d1e', border: 'rgba(255, 224, 185, 0.13)',
      accent: '#3987e5', accentInk: '#ffffff', goodText: '#0ca30c',
      shadowSm: '0 1px 2px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.40)',
      shadowMd: '0 4px 8px rgba(0,0,0,0.50), 0 12px 30px rgba(0,0,0,0.55)',
    },
  },
  ember: {
    label: 'Ember',
    light: {
      page: '#f4f4f6', surface: '#ffffff',
      ink: '#1e1e2c', ink2: '#52525f', muted: '#8b8b98',
      hairline: '#e9e9ef', border: 'rgba(30, 30, 44, 0.12)',
      accent: '#e0813c', accentInk: '#ffffff', goodText: '#0d7d68',
      shadowSm: '0 1px 2px rgba(30,30,44,0.05), 0 3px 10px rgba(30,30,44,0.07)',
      shadowMd: '0 3px 6px rgba(30,30,44,0.07), 0 10px 26px rgba(30,30,44,0.13)',
    },
    dark: {
      page: '#16161f', surface: '#1e1e2c',
      ink: '#f4f4f8', ink2: '#bcbcc9', muted: '#84848f',
      hairline: '#2e2e3d', border: 'rgba(255, 255, 255, 0.12)',
      accent: '#f29f67', accentInk: '#1e1e2c', goodText: '#34b1aa',
      shadowSm: '0 1px 2px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.40)',
      shadowMd: '0 4px 8px rgba(0,0,0,0.50), 0 12px 30px rgba(0,0,0,0.55)',
    },
  },
  lilac: {
    label: 'Lilac',
    light: {
      page: '#fefcff', surface: '#ffffff',
      ink: '#2a2438', ink2: '#5f5873', muted: '#948da6',
      hairline: '#ece8f2', border: 'rgba(78, 60, 120, 0.13)',
      accent: '#1c4586', accentInk: '#ffffff', goodText: '#0b7a43',
      warning: '#ffa74c', action: '#ffa74c', actionInk: '#33240f',
      shadowSm: '0 1px 2px rgba(80,60,130,0.05), 0 3px 10px rgba(80,60,130,0.07)',
      shadowMd: '0 3px 6px rgba(80,60,130,0.07), 0 10px 26px rgba(80,60,130,0.13)',
    },
    dark: {
      page: '#16131d', surface: '#201c2a',
      ink: '#f4f1fa', ink2: '#c8c2d8', muted: '#8f89a0',
      hairline: '#322c40', border: 'rgba(200, 180, 255, 0.14)',
      accent: '#8e7cc3', accentInk: '#ffffff', goodText: '#3fca8f',
      warning: '#ffa74c', action: '#ffa74c', actionInk: '#33240f',
      shadowSm: '0 1px 2px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.42)',
      shadowMd: '0 4px 8px rgba(0,0,0,0.50), 0 12px 30px rgba(0,0,0,0.55)',
    },
  },
  skydash: {
    label: 'Skydash',
    light: {
      page: '#f4f6fd', surface: '#ffffff',
      ink: '#23233c', ink2: '#56587a', muted: '#8f92ad',
      hairline: '#e7eaf6', border: 'rgba(75, 73, 172, 0.13)',
      accent: '#4b49ac', accentInk: '#ffffff', goodText: '#0c7a4d',
      shadowSm: '0 1px 2px rgba(75,73,172,0.05), 0 3px 10px rgba(75,73,172,0.08)',
      shadowMd: '0 3px 6px rgba(75,73,172,0.08), 0 10px 26px rgba(75,73,172,0.14)',
    },
    dark: {
      page: '#131327', surface: '#1d1d38',
      ink: '#f1f1fb', ink2: '#c2c4e2', muted: '#8b8dab',
      hairline: '#2d2d52', border: 'rgba(152, 189, 255, 0.16)',
      accent: '#7978e9', accentInk: '#ffffff', goodText: '#3ec98f',
      shadowSm: '0 1px 2px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.42)',
      shadowMd: '0 4px 8px rgba(0,0,0,0.50), 0 12px 30px rgba(0,0,0,0.55)',
    },
  },
};

export const MODES = ['auto', 'light', 'dark'];

// Brand wordmark colors — light modes only (dark falls back to --ink).
const BRAND_LIGHT = { follow: '#1c4586', up: '#8e7cc3' };

function vars(t, mode) {
  const brand = mode === 'light'
    ? `\n  --brand-follow: ${BRAND_LIGHT.follow}; --brand-up: ${BRAND_LIGHT.up};`
    : `\n  --brand-follow: ${t.ink}; --brand-up: ${t.ink};`;
  return `color-scheme: ${mode};
  --page: ${t.page}; --surface: ${t.surface};
  --ink: ${t.ink}; --ink-2: ${t.ink2}; --muted: ${t.muted};
  --hairline: ${t.hairline}; --border: ${t.border};
  --accent: ${t.accent}; --accent-ink: ${t.accentInk}; --good-text: ${t.goodText};
  --action: ${t.action ?? t.accent}; --action-ink: ${t.actionInk ?? t.accentInk};${t.warning ? `\n  --warning: ${t.warning};` : ''}
  --shadow-sm: ${t.shadowSm}; --shadow-md: ${t.shadowMd};${brand}`;
}

/** Token CSS for every scheme × mode; mode "auto" follows prefers-color-scheme. */
export function buildThemeCss() {
  const out = [`:root {\n  ${vars(THEMES.lilac.light, 'light')}\n}`];
  for (const [name, t] of Object.entries(THEMES)) {
    out.push(`html[data-scheme="${name}"] {\n  ${vars(t.light, 'light')}\n}`);
    out.push(`html[data-scheme="${name}"][data-mode="dark"] {\n  ${vars(t.dark, 'dark')}\n}`);
    out.push(`@media (prefers-color-scheme: dark) {\n  html[data-scheme="${name}"]:not([data-mode="light"]) {\n  ${vars(t.dark, 'dark')}\n  }\n}`);
  }
  return `/* --- generated theme tokens (src/themes.js) --- */\n${out.join('\n')}\n/* --- end generated --- */\n`;
}
