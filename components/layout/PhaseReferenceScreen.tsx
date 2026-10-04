'use client'

import { useState, useMemo } from 'react'
import { PhaseId, DrawerPayload, GlossaryRule, Roster, Strat, Unit } from '@/lib/types'
import { PHASES, SAMPLE_ROSTER, SAMPLE_STRATAGEMS } from '@/lib/sampleData'
import { stratagemMatchesPhase, stratagemNamesPhase } from '@/lib/stratagems'
import { TopBar } from './TopBar'
import { PhaseNav } from './PhaseNav'
import { PhaseSummary } from './PhaseSummary'
import { PhaseStratagemSection } from './PhaseStratagemSection'
import { RulesReferenceSection } from './RulesReferenceSection'
import { UnitPhaseSection } from '@/components/roster/UnitPhaseSection'
import { DetailDrawer } from '@/components/roster/DetailDrawer'
import styles from './PhaseReferenceScreen.module.css'

function makeLoadoutKey(unit: Unit): string {
  const weapons = (unit.full?.weapons ?? unit.weapons).map(w => w.name).sort().join('\x00')
  const enhancements = unit.enhancements.map(e => e.name).sort().join('\x00')
  const hot = [...unit.hot].sort().join('\x00')
  return [unit.name, weapons, enhancements, hot].join('\x01')
}

type UnitGroup = { key: string; unit: Unit; count: number }

function groupIdenticalUnits(units: Unit[]): UnitGroup[] {
  const map = new Map<string, UnitGroup>()
  for (const unit of units) {
    const key = makeLoadoutKey(unit)
    const existing = map.get(key)
    if (existing) { existing.count++; continue }
    map.set(key, { key, unit, count: 1 })
  }
  return [...map.values()]
}

interface Props {
  roster?: Roster
  stratagems?: Strat[]
  title?: string
  meta?: string
  version?: string
  points?: number
  cp?: number
  cpMax?: number
  /** The faction's army rule(s) — surfaced in the persistent Rules section. Undefined in demo mode. */
  armyRules?: GlossaryRule[]
  /** Rules of the matched detachment; empty when no detachment matched. */
  detachmentRules?: GlossaryRule[]
  /** Whether the roster's detachment resolved to a known one (drives the fallback note). */
  detachmentMatched?: boolean
  onBack?: () => void
}

export function PhaseReferenceScreen({
  roster,
  stratagems,
  title,
  meta,
  version,
  points,
  cp,
  cpMax,
  armyRules,
  detachmentRules,
  detachmentMatched,
  onBack,
}: Props) {
  // Collapse the two modes (live roster vs. demo) into a single object so the rest
  // of the component body never branches on `isDemo`.  When no roster is supplied
  // the demo defaults fill every slot; prop values always take precedence.
  const resolved = roster
    ? { roster, stratagems: stratagems ?? [], title: title ?? '', meta, version, points, cp, cpMax }
    : {
        roster: SAMPLE_ROSTER,
        stratagems: SAMPLE_STRATAGEMS,
        title: 'Strike Cadre',
        meta,
        version,
        points: points ?? 1995,
        cp: cp ?? 6,
        cpMax: cpMax ?? 12,
      }

  const [phase, setPhase] = useState<PhaseId>('command')
  const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(new Set())
  const [unitsCollapsed, setUnitsCollapsed] = useState(false)
  const [drawer, setDrawer] = useState<DrawerPayload>(null)

  // Phase rosters from `buildRoster` may contain units that exist for the
  // phase only because of the unfiltered baseline (e.g. command-phase entries
  // for every unit). With the redesigned card, a unit with zero phase-relevant
  // abilities AND zero phase-relevant weapons has nothing to surface as an
  // option — hide it from the list entirely. Reinforces the "this list is
  // your menu of actions for this phase" mental model.
  const phaseUnits = useMemo(
    () => resolved.roster[phase] ?? [],
    [resolved.roster, phase],
  )
  const units = phaseUnits.filter(u => u.abilities.length > 0 || u.weapons.length > 0)
  const groups = useMemo(
    () => groupIdenticalUnits(phaseUnits.filter(u => u.abilities.length > 0 || u.weapons.length > 0)),
    [phaseUnits],
  )

  // Filter detachment stratagems to those that apply to the active phase, then
  // sort so phase-specific stratagems appear first and "any phase" ones last.
  // stratagemMatchesPhase returns true for both groups; we distinguish them for
  // sorting via stratagemNamesPhase — if the timing string doesn't explicitly
  // name this phase, the stratagem is "any phase" and goes last.
  const phaseStratagems = resolved.stratagems
    .filter(s => stratagemMatchesPhase(s.timing, phase))
    .sort((a, b) => {
      const aSpecific = stratagemNamesPhase(a.timing, phase)
      const bSpecific = stratagemNamesPhase(b.timing, phase)
      if (aSpecific === bSpecific) return 0
      return aSpecific ? -1 : 1
    })

  function handlePhaseChange(id: PhaseId) {
    setPhase(id)
    setDrawer(null)
    setOpenGroupKeys(new Set())
  }

  function handleToggleUnit(key: string) {
    setOpenGroupKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const allOpen = groups.length > 0 && groups.every(g => openGroupKeys.has(g.key))

  function handleToggleAll() {
    setOpenGroupKeys(allOpen ? new Set() : new Set(groups.map(g => g.key)))
  }

  return (
    <div className="bf-app">
      <TopBar
        rosterName={resolved.title}
        meta={resolved.meta}
        version={resolved.version}
        points={resolved.points}
        cp={resolved.cp}
        cpMax={resolved.cpMax}
        onBack={onBack}
      />
      <PhaseNav phases={PHASES} activeId={phase} onChange={handlePhaseChange} />

      <div className={`bf-scroll ${styles.scroll}`}>
        <PhaseSummary units={units} stratagemCount={phaseStratagems.length} allOpen={allOpen}
          onToggleAll={handleToggleAll} />

        <PhaseStratagemSection stratagems={phaseStratagems} />

        {/* Units header — collapsible for visual parity with the rules/stratagem sections,
            but default expanded since the unit list is the primary content of the screen. */}
        {groups.length > 0 && (
          <div className={styles.unitsSection}>
            <button
              type="button"
              className={`bf-press ${styles.unitsHeader}`}
              onClick={() => setUnitsCollapsed(c => !c)}
            >
              <span className={styles.unitsLabel}>
                Units
                <span className={styles.unitsCount}>{groups.length}</span>
              </span>
              <span className={`${styles.unitsChevron} ${unitsCollapsed ? styles.unitsChevronCollapsed : ''}`}>
                ▲
              </span>
            </button>
          </div>
        )}

        {!unitsCollapsed && groups.map(g => (
          <UnitPhaseSection
            key={g.key}
            unit={g.unit}
            count={g.count}
            open={openGroupKeys.has(g.key)}
            phase={phase}
            onToggle={() => handleToggleUnit(g.key)}
            onOpenDetail={setDrawer}
          />
        ))}

        {units.length === 0 && (
          <div className={styles.empty}>
            No units for this phase.
          </div>
        )}

        {/* Army + detachment rules — persistent reference, pinned to the bottom of the
            scroll area and identical under every phase tab. Only rendered for a live
            roster built with rules data (undefined armyRules = demo/legacy → hidden). */}
        {armyRules !== undefined && (
          <RulesReferenceSection
            armyRules={armyRules}
            detachmentRules={detachmentRules ?? []}
            detachmentMatched={detachmentMatched ?? false}
          />
        )}
      </div>

      <DetailDrawer
        open={!!drawer}
        payload={drawer}
        onClose={() => setDrawer(null)}
      />
    </div>
  )
}
