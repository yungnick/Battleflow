import Link from 'next/link'
import styles from './TopBar.module.css'
import { ThemeToggle } from './ThemeToggle'

interface Props {
  rosterName: string
  points?: number
  cp?: number
  cpMax?: number
  meta?: string
  version?: string
  onBack?: () => void
}

export function TopBar({ rosterName, points, cp, cpMax, meta, version, onBack }: Props) {
  const subtitle = [meta, points != null ? `${points} pts` : undefined].filter(Boolean).join(' · ') || undefined
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {onBack ? (
          <button className={styles.icon} aria-label="Back to factions" onClick={onBack}>←</button>
        ) : (
          <Link href="/" className={styles.icon} aria-label="Home">◬</Link>
        )}
        <div className={styles.meta}>
          <span className={styles.rosterLabel}>{meta ? 'Faction' : 'Roster'}</span>
          <span className={styles.rosterName}>
            {rosterName}{subtitle ? ` · ${subtitle}` : ''}
          </span>
        </div>
      </div>
      <div className={styles.right}>
        {version && <span className={styles.version}>{version}</span>}
        {cp != null && <CPMeter cp={cp} max={cpMax ?? cp} />}
        <ThemeToggle />
      </div>
    </div>
  )
}

function CPMeter({ cp, max }: { cp: number; max: number }) {
  return (
    <div className={styles.cpMeter}>
      <div className={styles.cpIcon}>!</div>
      <div className={styles.cpValue}>
        <span className={styles.cpN}>{cp}</span>
        <span className={styles.cpMax}>/{max}</span>
        <span className={styles.cpLabel}>CP</span>
      </div>
    </div>
  )
}
