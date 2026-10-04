export type Theme = 'dark' | 'light'

export const THEME_KEY = 'bf_theme'

const THEME_COLORS: Record<Theme, string> = { dark: '#0a0b0e', light: '#eef0f3' }

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** Applies the theme to <html>, syncs <meta name="theme-color">, and persists it. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_COLORS[theme]))
  try { localStorage.setItem(THEME_KEY, theme) } catch {}
}

// Runs before first paint (inline in <head>) so there is no flash of the wrong theme.
// Saved choice → system preference → dark.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t;var c=t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',c)})}catch(e){}})()`
