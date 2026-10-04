import { Rule, DrawerPayload, Unit } from '@/lib/types'
import { stripRichText } from '@/lib/richText'
import { ConditionPill } from '@/components/ui/ConditionPill'
import styles from './RuleItem.module.css'

interface Props {
  rule: Rule
  unit: Unit
  onOpen: (payload: DrawerPayload) => void
}

export function RuleItem({ rule, unit, onOpen }: Props) {
  return (
    <button
      type="button"
      className={`bf-press ${styles.row}`}
      onClick={() => onOpen({ kind: 'ability', data: rule, unit })}
    >
      <div className={styles.header}>
        <span className={styles.name}>{rule.name}</span>
        <span className={styles.source}>{rule.source}</span>
      </div>
      <p className={styles.effect}>{stripRichText(rule.effect)}</p>
      {rule.cond && (
        <div className={styles.pills}>
          <ConditionPill kind="cond">{rule.cond}</ConditionPill>
        </div>
      )}
    </button>
  )
}
