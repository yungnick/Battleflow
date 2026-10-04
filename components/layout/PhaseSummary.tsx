import { Unit } from '@/lib/types'
import styles from './PhaseSummary.module.css'

interface Props {
  units: Unit[]
  stratagemCount?: number
  allOpen: boolean
  onToggleAll: () => void
}

export function PhaseSummary({ units, stratagemCount, allOpen, onToggleAll }: Props) {
  const totalWeapons = units.reduce((n, u) => n + (u.weapons?.length ?? 0), 0)
  const totalRules = units.reduce((n, u) => n + (u.abilities?.length ?? 0), 0)
  const totalStrats = stratagemCount ?? units.reduce((n, u) => n + (u.stratagems?.length ?? 0), 0)

  return (
    <div className={styles.strip}>
      <div className={styles.stats}>
        <Stat n={units.length} label="units" />
        <Stat n={totalWeapons} label="weapons" />
        <Stat n={totalRules} label="rules" />
        <Stat n={totalStrats} label="strat" highlight={totalStrats > 0} />
      </div>
      <button className={styles.expandBtn} onClick={onToggleAll}>
        {allOpen ? 'Close All' : 'Expand All'}
      </button>
    </div>
  )
}

function Stat({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statN} ${highlight ? styles.statHighlight : ''}`}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
