'use client'

import { useEffect } from 'react'
import { DrawerPayload, Weapon, Rule, Strat } from '@/lib/types'
import { StatRow } from '@/components/ui/StatRow'
import { ModifierBadge } from '@/components/ui/ModifierBadge'
import { ConditionPill } from '@/components/ui/ConditionPill'
import { RichText } from '@/components/ui/RichText'
import { CPCost } from '@/components/ui/CPCost'
import styles from './DetailDrawer.module.css'

interface Props {
  open: boolean
  payload: DrawerPayload
  onClose: () => void
}

function kindLabel(kind: 'weapon' | 'ability' | 'stratagem' | 'enhancement') {
  if (kind === 'weapon') return 'Weapon'
  if (kind === 'ability') return 'Ability'
  if (kind === 'enhancement') return 'Enhancement'
  return 'Stratagem'
}

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={`bf-eyebrow ${styles.fieldLabel}`}>{label}</div>
      {children}
    </div>
  )
}

export function DetailDrawer({ open, payload, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !payload) return null
  const { kind, data, unit } = payload

  const w = kind === 'weapon' ? (data as Weapon) : null
  const weaponContent = w ? (
    <>
      <DrawerField label="Profile">
        <StatRow stats={w.stats} />
      </DrawerField>
      <DrawerField label="Keywords">
        <div className={styles.keywordRow}>
          {w.tags.map(t => <span key={t} className={styles.keyword}>{t}</span>)}
        </div>
      </DrawerField>
      {w.mods.length > 0 && (
        <DrawerField label="Active Modifiers">
          <div className={styles.modList}>
            {w.mods.map(m => (
              <div key={m.label} className={styles.modItem}>
                <ModifierBadge label={m.label} />
                {m.cond && <span className={styles.modCond}>{m.cond}</span>}
              </div>
            ))}
          </div>
        </DrawerField>
      )}
    </>
  ) : null

  const r = (kind === 'ability' || kind === 'stratagem' || kind === 'enhancement') ? (data as Rule | Strat) : null
  const ruleContent = r ? (
    <>
      <DrawerField label="Effect">
        <RichText className={styles.effectText} text={r.effect} />
      </DrawerField>
      {r.timing && (
        <DrawerField label="Timing">
          <span className={styles.timing}>{r.timing}</span>
        </DrawerField>
      )}
      <DrawerField label="Conditions">
        <div className={styles.pills}>
          {r.cond && <ConditionPill kind="cond">{r.cond}</ConditionPill>}
          {'once' in r && r.once === 'battle' && <ConditionPill kind="once">Once / battle</ConditionPill>}
          {'once' in r && r.once === 'phase' && <ConditionPill kind="once">Once / phase</ConditionPill>}
          {kind === 'stratagem' && <ConditionPill kind="cp">Requires {(r as Strat).cp} CP</ConditionPill>}
        </div>
      </DrawerField>
      <DrawerField label="Affected">
        <span className={styles.affected}>{unit.name}</span>
      </DrawerField>
      {r.source && (
        <DrawerField label="Source">
          <span className={styles.source}>{r.source}</span>
        </DrawerField>
      )}
    </>
  ) : null

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={data.name}>
        <div className={styles.grabberWrap}>
          <div className={styles.grabber} />
        </div>

        <div className={styles.sheetHeader}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrow}>
              {kindLabel(kind)} · {unit.name}
            </span>
            <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className={styles.titleRow}>
            {kind === 'stratagem' && <CPCost n={(data as Strat).cp} />}
            <h2 className={styles.title}>{data.name}</h2>
          </div>
        </div>

        <div className={styles.body}>
          {weaponContent}
          {ruleContent}
        </div>
      </div>
    </>
  )
}
