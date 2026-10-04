'use client'

import { useSyncExternalStore } from 'react'
import { applyTheme, type Theme } from '../../lib/theme'
import styles from './TopBar.module.css'

// <html data-theme> is the source of truth (set pre-paint by the init script),
// so we subscribe to attribute changes on it.
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => obs.disconnect()
}

const getSnapshot = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
const getServerSnapshot = (): Theme => 'dark'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const next: Theme = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      className={styles.themeBtn}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => applyTheme(next)}
    >
      {/* Both icons render; CSS shows the one matching <html data-theme>, so there's no icon flash. */}
      <svg className={styles.sun} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.5 2.5l1.5 1.5M10 10l1.5 1.5M2.5 11.5L4 10M10 4l1.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
      <svg className={styles.moon} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M11.5 8.3A4.8 4.8 0 0 1 5.7 2.5a4.8 4.8 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
      </svg>
    </button>
  )
}
