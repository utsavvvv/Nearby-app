// Light / Dark / System appearance.
const KEY = 'theme';
const THEME_COLORS = { light: '#0f766e', dark: '#134e48' };
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function getTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '"system"');
    return ['light', 'dark', 'system'].includes(t) ? t : 'system';
  } catch { return 'system'; }
}

/** Whether dark colours are showing right now. */
export function isDark(theme = getTheme()) {
  return theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
}

function apply() {
  const theme = getTheme();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[isDark(theme) ? 'dark' : 'light']);
  listeners.forEach((fn) => fn({ theme, dark: isDark(theme) }));
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch { /* ignore */ }
  apply();
}

/** Calls fn({ theme, dark }) now and whenever the theme or the phone's setting changes. */
export function onThemeChange(fn) {
  listeners.add(fn);
  fn({ theme: getTheme(), dark: isDark() });
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', () => { if (getTheme() === 'system') apply(); });
apply();
