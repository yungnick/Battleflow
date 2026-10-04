import { useMemo, useState } from 'react'
import { Unit, DrawerPayload, Weapon, Stats, PhaseId, UnitAbility } from '@/lib/types'
import { WeaponProfileRow } from './WeaponProfileRow'
import { RuleItem } from './RuleItem'
import { StatRow } from '@/components/ui/StatRow'
import { fullSaves, nameplateSaves } from '@/lib/roster/invulnSave'
import styles from './UnitPhaseSection.module.css'

interface Props {
  unit: Unit
  count?: number
  open: boolean
  phase?: PhaseId
  onToggle: () => void
  onOpenDetail: (payload: DrawerPayload) => void
}

/** Nameplate stats per phase. `Sv` is always last and expands to the Sv / InSv cell(s). */
const MINI_KEYS: Record<PhaseId, readonly string[]> = {
  command: ['M', 'T', 'W', 'LD', 'Sv'],
  movement: ['M'],
  shooting: ['T', 'W', 'Sv'],
  charge: ['T', 'W', 'Sv'],
  fight: ['T', 'W', 'Sv'],
  battleshock: ['LD'],
}

function miniProfileKeys(phase?: PhaseId): readonly string[] {
  return phase ? MINI_KEYS[phase] : MINI_KEYS.fight
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-profile weapon grouping
//
// BSData names sub-profiles with a leading "➤" and a trailing " - <profile>"
// suffix (e.g. "➤ Power sword - strike" / "➤ Power sword - sweep"). For the
// decision menu the player needs exclusivity made explicit: those siblings
// collapse under their shared base name with a "(choose one)" label. Plain
// weapons render flat.
// ─────────────────────────────────────────────────────────────────────────

type WeaponGroup =
  | { kind: 'single'; weapon: Weapon }
  | { kind: 'multi'; baseName: string; profiles: { label: string; weapon: Weapon }[] }

function parseProfileName(name: string): { base: string; profile: string | null } {
  if (!name.startsWith('➤')) return { base: name, profile: null }
  const stripped = name.replace(/^➤\s*/, '')
  const dash = stripped.lastIndexOf(' - ')
  if (dash < 0) return { base: stripped, profile: null }
  return { base: stripped.slice(0, dash), profile: stripped.slice(dash + 3) }
}

function groupWeapons(weapons: Weapon[]): WeaponGroup[] {
  const groups: WeaponGroup[] = []
  const multiByBase = new Map<string, Extract<WeaponGroup, { kind: 'multi' }>>()

  for (const weapon of weapons) {
    const { base, profile } = parseProfileName(weapon.name)
    if (profile === null) {
      groups.push({ kind: 'single', weapon })
      continue
    }
    let group = multiByBase.get(base)
    if (!group) {
      group = { kind: 'multi', baseName: base, profiles: [] }
      multiByBase.set(base, group)
      groups.push(group)
    }
    group.profiles.push({ label: profile, weapon })
  }

  // If a multi-group has a single surviving sub-profile (e.g. wargear
  // filtering kept only one), flatten it back to a single row with the
  // profile name folded into the display name — "(choose one)" would lie.
  return groups.map(g => {
    if (g.kind === 'multi' && g.profiles.length === 1) {
      const { label, weapon } = g.profiles[0]
      return {
        kind: 'single' as const,
        weapon: { ...weapon, name: `${g.baseName} (${label})` },
      }
    }
    return g
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Ability hierarchy
//
// Schema v2 classifies each datasheet ability (the army-level `faction` rule is
// already filtered out in buildRoster) and, for themed sub-ability profiles,
// tags a `group`. We turn that flat-but-typed list into three render buckets so
// the collapsed card can show a readable hierarchy instead of N equal chips:
//
//   1. datasheet — the unit's own bespoke abilities → prominent chips.
//   2. groups    — themed sub-ability sets (Be'lakor "Shadow Form", Magnus
//                  "Crimson King", …) → one expandable chip each.
//   3. core      — edition-wide keywords (Deep Strike, Stealth, …) → a single
//                  muted keyword strip.
//
// Bucket order matches the collapsed-card layout: datasheet → groups → core.
// ─────────────────────────────────────────────────────────────────────────

type AbilityGroup = { name: string; blurb?: string; abilities: UnitAbility[] }
type AbilityBuckets = {
  datasheet: UnitAbility[]
  groups: AbilityGroup[]
  core: UnitAbility[]
}

function partitionAbilities(abilities: UnitAbility[]): AbilityBuckets {
  const datasheet: UnitAbility[] = []
  const core: UnitAbility[] = []
  const groups: AbilityGroup[] = []
  const groupByName = new Map<string, AbilityGroup>()

  for (const ability of abilities) {
    if (ability.category === 'core') {
      core.push(ability)
      continue
    }
    // `faction` is excluded upstream (army-level section); guard defensively.
    if (ability.category === 'faction') continue

    if (ability.group) {
      let group = groupByName.get(ability.group)
      if (!group) {
        group = { name: ability.group, abilities: [] }
        groupByName.set(ability.group, group)
        groups.push(group)
      }
      // The same-named parent ability's text rides on every child as `groupBlurb`;
      // take the first one we see as the group's heading.
      if (!group.blurb && ability.groupBlurb) group.blurb = ability.groupBlurb
      group.abilities.push(ability)
      continue
    }

    datasheet.push(ability)
  }

  return { datasheet, groups, core }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function SubSection({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div className={styles.subHeader}>
        <span className="bf-eyebrow">{label}</span>
        {count != null && <span className={styles.subCount}>· {count}</span>}
      </div>
      {children}
    </div>
  )
}

/** A single tappable ability chip — opens the ability drawer. Shared by the
 *  prominent datasheet row and the children of an expanded themed group. */
function AbilityChip({
  ability, unit, onOpen,
}: {
  ability: UnitAbility
  unit: Unit
  onOpen: (p: DrawerPayload) => void
}) {
  return (
    <button
      type="button"
      className={`bf-press ${styles.abilityChip}`}
      onClick={() => onOpen({ kind: 'ability', data: ability, unit })}
    >
      {ability.name}
    </button>
  )
}

/**
 * A themed sub-ability group rendered as one expandable chip (Step 3).
 *
 * Collapsed it shows just the group name and a child count; tapping it reveals
 * the parent blurb (when present) followed by each child ability as its own
 * tappable chip. Mirrors the weapon "(choose one)" multi-group: a header with an
 * indented child column. State is local to the chip — each group expands
 * independently, and collapsing a card doesn't lose the menu's expansion state.
 */
function AbilityGroupChip({
  group, unit, onOpen,
}: {
  group: AbilityGroup
  unit: Unit
  onOpen: (p: DrawerPayload) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.abilityGroup}>
      <button
        type="button"
        className={`bf-press ${styles.groupChip}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span
          className={styles.groupCaret}
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <svg width="7" height="9" viewBox="0 0 8 10">
            <path d="M1 1l5 4-5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        {group.name}
        <span className={styles.groupCount}>{group.abilities.length}</span>
      </button>
      {open && (
        <div className={styles.groupChildren}>
          {group.blurb && <p className={styles.groupBlurb}>{group.blurb}</p>}
          <div className={styles.chipRow}>
            {group.abilities.map((ability, i) => (
              <AbilityChip key={`${ability.name}-${i}`} ability={ability} unit={unit} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Core/universal abilities as one compact, muted keyword strip (Step 2).
 *
 * Core abilities (Deep Strike, Stealth, Leader, …) are edition-wide and read at
 * a glance, so they're demoted from full chips to a quiet inline strip. Each
 * keyword is still tappable and opens its (inline) text in the drawer.
 */
function CoreStrip({
  abilities, unit, onOpen,
}: {
  abilities: UnitAbility[]
  unit: Unit
  onOpen: (p: DrawerPayload) => void
}) {
  return (
    <div className={styles.coreStrip}>
      {abilities.map((ability, i) => (
        <button
          key={`${ability.name}-${i}`}
          type="button"
          className={`bf-press ${styles.coreKeyword}`}
          onClick={() => onOpen({ kind: 'ability', data: ability, unit })}
        >
          {ability.name}
        </button>
      ))}
    </div>
  )
}

/** Expanded profile: both saves in one `Sv` cell ("4+ / 4++"; invuln only when the unit has one). */
function splitSaves(stats: Stats): Stats {
  const out: Stats = {}
  for (const [k, v] of Object.entries(stats)) {
    if (k === 'Sv') out.Sv = fullSaves(stats).map(c => c.value).join(' / ')
    else if (k !== 'InSv') out[k] = v
  }
  return out
}

/** Stat summary on the right of the header. Keys depend on active phase. */
function MiniProfile({ stats, phase }: { stats?: Stats; phase?: PhaseId }) {
  if (!stats) return null
  const keys = miniProfileKeys(phase)
  const cells = keys.flatMap(k => {
    if (!(k in stats)) return []
    if (k === 'Sv') return nameplateSaves(stats)
    return [{ label: k, value: stats[k] }]
  })
  if (cells.length === 0) return null
  return (
    <span className={styles.miniProfile}>
      {cells.map((c, i) => (
        <span key={`${c.label}-${i}`} className={styles.miniStat}>
          <span className={styles.miniKey}>{c.label}</span>
          <span className={styles.miniValue}>{c.value}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * One row in the "Can fight" / "Can shoot" list.
 *
 *  - Single weapon: `displayName` is the weapon's own name.
 *  - Multi sub-profile: `displayName` is just the profile label (Strike /
 *    Sweep / …); the base name lives in the group header above, and
 *    `indented` shifts the row to align under it.
 */
function CompactWeaponRow({
  displayName, weapon, unit, onOpen, indented,
}: {
  displayName: string
  weapon: Weapon
  unit: Unit
  onOpen: (p: DrawerPayload) => void
  indented?: boolean
}) {
  return (
    <button
      type="button"
      className={`bf-press ${styles.weaponRow}${indented ? ' ' + styles.weaponRowIndented : ''}`}
      onClick={() => onOpen({ kind: 'weapon', data: weapon, unit })}
    >
      <span className={styles.weaponName}>{displayName}</span>
      <StatRow stats={weapon.stats} />
      {weapon.tags.length > 0 && (
        <div className={styles.weaponTags}>
          {weapon.tags.map(t => (
            <span key={t} className={styles.weaponTag}>{t}</span>
          ))}
        </div>
      )}
    </button>
  )
}

function WeaponGroupView({
  group, unit, onOpen,
}: {
  group: WeaponGroup
  unit: Unit
  onOpen: (p: DrawerPayload) => void
}) {
  if (group.kind === 'single') {
    return (
      <CompactWeaponRow
        displayName={group.weapon.name}
        weapon={group.weapon}
        unit={unit}
        onOpen={onOpen}
      />
    )
  }
  return (
    <div className={styles.multiGroup}>
      <div className={styles.multiHeader}>
        <span className={styles.weaponName}>{group.baseName}</span>
        <span className={styles.chooseOne}>(choose one)</span>
      </div>
      <div className={styles.multiProfiles}>
        {group.profiles.map((p, i) => (
          <CompactWeaponRow
            key={`${p.label}-${i}`}
            displayName={p.label}
            weapon={p.weapon}
            unit={unit}
            onOpen={onOpen}
            indented
          />
        ))}
      </div>
    </div>
  )
}

function WeaponMenuRow({
  groups, unit, onOpen,
}: {
  groups: WeaponGroup[]
  unit: Unit
  onOpen: (p: DrawerPayload) => void
}) {
  return (
    <div className={styles.menuRow}>
      <div className={styles.weaponList}>
        {groups.map((g, i) => (
          <WeaponGroupView
            key={g.kind === 'single' ? g.weapon.name + i : g.baseName}
            group={g}
            unit={unit}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export function UnitPhaseSection({ unit, count, open, phase, onToggle, onOpenDetail }: Props) {
  // The collapsed menu reads from the phase-filtered top-level fields
  // (already trimmed by buildRoster). The expanded datasheet reads from
  // `unit.full` — or falls back to the top-level fields for hand-crafted
  // rosters like SAMPLE_ROSTER that aren't phase-filtered to begin with.
  const full = unit.full ?? {
    stats: unit.stats,
    weapons: unit.weapons,
    abilities: unit.abilities,
    damaged: unit.damaged,
  }

  // Split the phase-filtered abilities into the three render buckets the
  // collapsed menu lays out in order: datasheet chips → group chips → Core strip.
  // Core abilities keep today's phase-filter behaviour (passive ones surface on
  // every tab) for consistency with the rest of the menu.
  const { datasheet, groups, core } = useMemo(
    () => partitionAbilities(unit.abilities),
    [unit.abilities],
  )

  // Split by kind so the menu shows one row per action verb. The phase filter
  // typically leaves only one kind populated; SAMPLE_ROSTER (unfiltered demo)
  // can have both, in which case the unit gets both "Can shoot" and "Can fight"
  // rows.
  const meleeGroups = useMemo(
    () => groupWeapons(unit.weapons.filter(w => w.kind === 'melee')),
    [unit.weapons],
  )
  const rangedGroups = useMemo(
    () => groupWeapons(unit.weapons.filter(w => w.kind === 'ranged')),
    [unit.weapons],
  )

  return (
    <div className={styles.card}>
      {/*
        Header is its own button — tapping anywhere on the header toggles
        expand/collapse. The decision menu below sits OUTSIDE this button so
        its chip/weapon-row buttons can nest without breaking HTML semantics.
      */}
      <button
        type="button"
        className={`bf-press ${styles.header}`}
        onClick={onToggle}
      >
        <span
          className={styles.caret}
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <svg width="8" height="10" viewBox="0 0 8 10">
            <path d="M1 1l5 4-5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className={styles.unitName}>{unit.name}</span>
        {count != null && count > 1 && (
          <span className={styles.countBadge}>×{count}</span>
        )}
        <MiniProfile stats={full.stats} phase={phase} />
      </button>

      {(unit.enhancements.length > 0 || unit.hot.length > 0) && (
        <div className={styles.hotRow}>
          {unit.enhancements.map((enh, i) => (
            <button
              key={`${enh.name}-${i}`}
              type="button"
              className={`bf-press ${styles.enhancementChip}`}
              onClick={() => onOpenDetail({ kind: 'enhancement', data: enh, unit })}
            >
              {enh.name}
            </button>
          ))}
          {unit.hot.map(h => (
            <span key={h} className={styles.hotChip}>{h}</span>
          ))}
        </div>
      )}

      {/*
        Decision menu — always rendered. Phase-filtered: shows only what the
        unit can actually do in the active phase. Each chip / weapon row is
        independently tappable and opens the drawer for that item.
      */}
      <div className={styles.menu}>
        {/* Abilities, in hierarchy order: datasheet chips → group chips → Core strip. */}
        {datasheet.length > 0 && (
          <div className={styles.menuRow}>
            <div className={styles.chipRow}>
              {datasheet.map((ability, i) => (
                <AbilityChip key={`${ability.name}-${i}`} ability={ability} unit={unit} onOpen={onOpenDetail} />
              ))}
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <div className={styles.menuRow}>
            <div className={styles.groupList}>
              {groups.map(group => (
                <AbilityGroupChip key={group.name} group={group} unit={unit} onOpen={onOpenDetail} />
              ))}
            </div>
          </div>
        )}

        {core.length > 0 && (
          <div className={styles.menuRow}>
            <CoreStrip abilities={core} unit={unit} onOpen={onOpenDetail} />
          </div>
        )}

        {rangedGroups.length > 0 && (
          <WeaponMenuRow groups={rangedGroups} unit={unit} onOpen={onOpenDetail} />
        )}

        {meleeGroups.length > 0 && (
          <WeaponMenuRow groups={meleeGroups} unit={unit} onOpen={onOpenDetail} />
        )}
      </div>

      {/*
        Expanded body — full datasheet, phase-agnostic. "Flip the card over"
        to read every weapon profile and ability text in full.
      */}
      {open && (
        <div className={styles.body}>
          {full.stats && Object.keys(full.stats).length > 0 && (
            <SubSection label="Profile">
              <div className={styles.profileRow}>
                <StatRow stats={splitSaves(full.stats)} />
              </div>
            </SubSection>
          )}

          {/*
            Damaged profile gets its own row, next to the statline it degrades —
            parallel to how the invuln save folds into SV. Carved out of the
            ability stream at ingest so it no longer competes with real abilities.
          */}
          {full.damaged && (
            <>
              {full.stats && Object.keys(full.stats).length > 0 && <hr className="bf-rule" />}
              <SubSection label="Damaged">
                <div className={styles.itemList}>
                  <RuleItem rule={full.damaged} unit={unit} onOpen={onOpenDetail} />
                </div>
              </SubSection>
            </>
          )}

          {full.weapons.length > 0 && (
            <>
              {full.stats && Object.keys(full.stats).length > 0 && <hr className="bf-rule" />}
              <SubSection label="Weapons" count={full.weapons.length}>
                <div className={styles.itemList}>
                  {full.weapons.map((w, i) => (
                    <div key={`${w.kind}-${w.name}-${i}`} className={i > 0 ? styles.itemSep : undefined}>
                      <WeaponProfileRow weapon={w} unit={unit} onOpen={onOpenDetail} />
                    </div>
                  ))}
                </div>
              </SubSection>
            </>
          )}

          {full.abilities.length > 0 && (
            <>
              <hr className="bf-rule" />
              <SubSection label="Abilities" count={full.abilities.length}>
                <div className={styles.itemList}>
                  {full.abilities.map((r, i) => (
                    <div key={`${r.name}-${i}`} className={i > 0 ? styles.itemSep : undefined}>
                      {/* Themed-group intro blurb rides on the group's first child
                          (see normalize.buildUnitAbilities) — render it as a heading
                          above that ability so the expanded view keeps the group's
                          context, not just its bare members. */}
                      {r.group && r.groupBlurb && (
                        <div className={styles.fullGroupHead}>
                          <span className={styles.fullGroupName}>{r.group}</span>
                          <p className={styles.fullGroupBlurb}>{r.groupBlurb}</p>
                        </div>
                      )}
                      <RuleItem rule={r} unit={unit} onOpen={onOpenDetail} />
                    </div>
                  ))}
                </div>
              </SubSection>
            </>
          )}

          {unit.reminders.length > 0 && (
            <>
              <hr className="bf-rule" />
              <SubSection label="Reminders">
                {unit.reminders.map((r) => (
                  <div key={r.text} className={styles.reminder}>
                    <span className={styles.reminderIcon}>※</span>
                    <span>{r.text}</span>
                  </div>
                ))}
              </SubSection>
            </>
          )}

          {unit.tags.length > 0 && (
            <>
              <hr className="bf-rule" />
              <SubSection label="Keywords">
                <div className={styles.keywordRow}>
                  {unit.tags.map((tag) => (
                    <span key={tag} className={styles.keywordPill}>{tag}</span>
                  ))}
                </div>
              </SubSection>
            </>
          )}
        </div>
      )}
    </div>
  )
}
