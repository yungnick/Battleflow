import { Weapon, DrawerPayload, Unit } from '@/lib/types'
import { KindTag } from '@/components/ui/KindTag'
import { StatRow } from '@/components/ui/StatRow'
import { ModifierBadge } from '@/components/ui/ModifierBadge'
import styles from './WeaponProfileRow.module.css'

interface Props {
  weapon: Weapon
  unit: Unit
  onOpen: (payload: DrawerPayload) => void
}

export function WeaponProfileRow({ weapon, unit, onOpen }: Props) {
  return (
    <button
      type="button"
      className={`bf-press ${styles.row}`}
      onClick={() => onOpen({ kind: 'weapon', data: weapon, unit })}
    >
      <div className={styles.header}>
        <span className={styles.name}>
          {weapon.count && weapon.count > 1 && (
            <span className={styles.count}>{weapon.count}×</span>
          )}
          {weapon.name}
        </span>
        <KindTag kind={weapon.kind} />
      </div>

      <StatRow stats={weapon.stats} />

      {weapon.tags.length > 0 && (
        <div className={styles.tags}>
          {weapon.tags.map(t => (
            <span key={t} className={styles.tag}>{t}</span>
          ))}
        </div>
      )}

      {weapon.mods.length > 0 && (
        <div className={styles.mods}>
          {weapon.mods.map(m => (
            <div key={m.label} className={styles.modRow}>
              <ModifierBadge label={m.label} dense />
              {m.cond && <span className={styles.modCond}>{m.cond}</span>}
            </div>
          ))}
        </div>
      )}
    </button>
  )
}
