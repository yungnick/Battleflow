'use client'

import { useState } from 'react'
import { Strat } from '@/lib/types'
import { CPCost } from '@/components/ui/CPCost'
import { ConditionPill } from '@/components/ui/ConditionPill'
import { RichText } from '@/components/ui/RichText'
import styles from './PhaseStratagemSection.module.css'

interface Props {
  stratagems: Strat[]
}

export function PhaseStratagemSection({ stratagems }: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  if (stratagems.length === 0) return null

  // Composite key for expand/collapse state. Using only `strat.name` caused
  // collisions when different detachments share a stratagem name (e.g. both have a
  // "Rapid Deployment" variant). The `::` separator is safely absent from faction
  // and stratagem names; the React card `key` below uses `-` for the same reason.
  function openKey(strat: (typeof stratagems)[number]): string {
    return `${strat.source}::${strat.name}`
  }

  function toggleOpen(key: string) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={`bf-press ${styles.sectionHeader}`}
        onClick={() => setCollapsed(c => !c)}
      >
        <span className={styles.sectionLabel}>
          Stratagems
          <span className={styles.count}>{stratagems.length}</span>
        </span>
        <span className={`${styles.chevron} ${collapsed ? styles.chevronDown : ''}`}>
          ▲
        </span>
      </button>

      {!collapsed && (
        <div className={styles.list}>
          {stratagems.map((strat) => {
            const key = openKey(strat)
            const isOpen = openIds.has(key)
            return (
              <div key={`${strat.source}-${strat.name}`} className={styles.itemWrap}>
                <button
                  type="button"
                  className={`bf-press ${styles.card}`}
                  onClick={() => toggleOpen(key)}
                >
                  <div className={styles.cardTop}>
                    <CPCost n={strat.cp} />
                    <span className={styles.name}>{strat.name}</span>
                    <span className={styles.expand}>{isOpen ? '−' : '+'}</span>
                  </div>
                  {strat.summary && !isOpen && (
                    <p className={styles.summary}>{strat.summary}</p>
                  )}
                  {isOpen && (
                    <div className={styles.expanded}>
                      {strat.timing && (
                        <p className={styles.timing}>{strat.timing}</p>
                      )}
                      <RichText className={styles.effect} text={strat.effect} />
                      <div className={styles.pills}>
                        {strat.cond && <ConditionPill kind="cond">{strat.cond}</ConditionPill>}
                        {strat.once === 'battle' && <ConditionPill kind="once">Once / battle</ConditionPill>}
                        {strat.once === 'phase' && <ConditionPill kind="once">Once / phase</ConditionPill>}
                      </div>
                    </div>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
