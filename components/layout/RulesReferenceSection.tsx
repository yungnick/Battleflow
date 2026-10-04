'use client'

import { useState } from 'react'
import { GlossaryRule } from '@/lib/types'
import { RichText } from '@/components/ui/RichText'
import styles from './RulesReferenceSection.module.css'

interface Props {
  /**
   * The faction's army rule(s) (e.g. Oath of Moment), flagged in the glossary at ingest.
   * `GlossaryRule` (rather than the bare `Rule`) so cards can surface `options` — the
   * Cabal Rituals / Blessings of Khorne reference tables Thousand Sons / World Eaters
   * point players at (see `lib/ingest/armyRuleOptions.ts`).
   */
  armyRules: GlossaryRule[]
  /** Rules of the roster's matched detachment; empty when no detachment matched. */
  detachmentRules: GlossaryRule[]
  /** Whether the roster's detachment resolved to a known one (controls the fallback note). */
  detachmentMatched: boolean
}

/**
 * Always-available reference for the roster's army + detachment rules.
 *
 * Modeled on {@link PhaseStratagemSection}: a collapsed-by-default, collapsible section
 * with a count badge and expandable rule cards (name → effect). Unlike the stratagem
 * section it is NOT phase-filtered — army/detachment rules are persistent reference and
 * render identically under every phase tab. `PhaseReferenceScreen` pins it to the bottom
 * of the scroll area.
 *
 * Renders army rules first, then detachment rules. When the detachment wasn't recognised,
 * a small note explains that only army rules are shown. Returns `null` when there is
 * nothing to surface (no rules and nothing to note), which also keeps it hidden in demo mode.
 */
export function RulesReferenceSection({ armyRules, detachmentRules, detachmentMatched }: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  const total = armyRules.length + detachmentRules.length
  const showNote = !detachmentMatched
  // Nothing to surface — stay hidden (also the demo-mode path, which passes empty + matched).
  if (total === 0 && !showNote) return null

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Group label keeps the two rule kinds distinct; the rule name alone can collide across
  // groups, so the open-state key is namespaced by group.
  function renderGroup(label: string, rules: GlossaryRule[]) {
    if (rules.length === 0) return null
    return (
      <div className={styles.group}>
        <div className={styles.groupLabel}>{label}</div>
        {rules.map(rule => {
          const key = `${label}::${rule.name}`
          const isOpen = openKeys.has(key)
          return (
            <div key={key} className={styles.itemWrap}>
              <button
                type="button"
                className={`bf-press ${styles.card}`}
                onClick={() => toggle(key)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.name}>{rule.name}</span>
                  <span className={styles.expand}>{isOpen ? '−' : '+'}</span>
                </div>
                {isOpen && <RichText className={styles.effect} text={rule.effect} />}
                {/* Reference table the army rule points players at (Cabal Rituals /
                    Blessings of Khorne) — opens and closes with the parent card. */}
                {isOpen && rule.options && rule.options.length > 0 && (
                  <ul className={styles.options}>
                    {rule.options.map(option => (
                      <li key={option.name} className={styles.option}>
                        <div className={styles.optionTop}>
                          <span className={styles.optionName}>{option.name}</span>
                          <span className={styles.requirement}>
                            {option.requirementLabel}: {option.requirement}
                          </span>
                        </div>
                        <RichText className={styles.optionEffect} text={option.effect} />
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={`bf-press ${styles.sectionHeader}`}
        onClick={() => setCollapsed(c => !c)}
      >
        <span className={styles.sectionLabel}>
          Army &amp; Detachment Rules
          {total > 0 && <span className={styles.count}>{total}</span>}
        </span>
        <span className={`${styles.chevron} ${collapsed ? styles.chevronDown : ''}`}>
          ▲
        </span>
      </button>

      {!collapsed && (
        <div className={styles.list}>
          {renderGroup('Army Rule', armyRules)}
          {renderGroup('Detachment Rule', detachmentRules)}
          {showNote && (
            <p className={styles.note}>
              Detachment not recognized — showing army rules only.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
