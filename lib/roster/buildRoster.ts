import type { DetachmentRule, FactionArtifact, GlossaryRule, PreparedUnit } from '../dataModel'
import type { PhaseId, Roster, Rule, Stats, Strat, UnitAbility, Unit, Weapon } from '../types'
import type { ParsedArmy } from './parseGwText'
import { norm } from './normalize'
import { abilityPhasesFor } from './abilityPhase'
import { findPlainInvulnSave, stripPlainInvulnSave, withInvulnSv } from './invulnSave'

const NON_WEAPON_PHASES: PhaseId[] = ['command', 'movement', 'charge', 'battleshock']
const WEAPON_PHASES: { phase: PhaseId; kind: 'melee' | 'ranged' }[] = [
  { phase: 'fight', kind: 'melee' },
  { phase: 'shooting', kind: 'ranged' },
]

/**
 * Statline keys that are actually consulted in each phase.
 *
 *  - command / battleshock → LD (Leadership) and OC (Objective Control)
 *  - movement / charge     → M (Move) and OC
 *  - shooting / fight      → T (Toughness), SV (Save), W (Wounds)
 *
 * WS / BS aren't listed here — those ride on the weapon profile, not the
 * unit statline, so the weapon-kind filter already covers them.
 */
const STATS_BY_PHASE: Record<PhaseId, readonly string[]> = {
  command:     ['LD', 'OC'],
  movement:    ['M', 'OC'],
  shooting:    ['T', 'SV', 'W'],
  charge:      ['M', 'OC'],
  fight:       ['T', 'SV', 'W'],
  battleshock: ['LD', 'OC'],
}

/** Project `stats` down to the keys relevant for `phase`. Missing keys are dropped silently. */
function pickStats(stats: Stats | undefined, phase: PhaseId): Stats | undefined {
  if (!stats) return undefined
  const picked: Stats = {}
  for (const key of STATS_BY_PHASE[phase]) {
    if (key in stats) picked[key] = stats[key]
  }
  return picked
}

/**
 * Select the structured abilities the card renders, dropping only the army-level rule.
 *
 * Schema v2 stores abilities classified as core / faction / datasheet plus a separated
 * `damaged` profile. The card consumes the structure directly (Core strip, themed-group
 * expanders, plain chips), so we keep it intact and only drop the **faction** ability —
 * the army rule is rendered once in the army-level section (`RosterMeta.armyRules`), not
 * repeated on every unit (fixing the old leak). The `damaged` profile is surfaced as its
 * own `Unit.damaged` field rather than folded into this list, so the expanded card can
 * give it a dedicated row.
 */
function selectUnitAbilities(unit: PreparedUnit): UnitAbility[] {
  return unit.abilities.filter(a => a.category !== 'faction')
}

function dedup(strs: string[]): string[] {
  const seen = new Set<string>()
  return strs.filter(s => {
    const k = norm(s)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function matchUnit(name: string, units: PreparedUnit[]): PreparedUnit | undefined {
  const key = norm(name)

  const exact = units.find(u => norm(u.name) === key)
  if (exact) return exact

  // Faction prefix omitted: "Sorcerer" exported, "Thousand Sons Sorcerer" in artifact.
  const suffixed = units.filter(u => norm(u.name).endsWith(` ${key}`))
  if (suffixed.length === 1) return suffixed[0]

  // Multiple suffix candidates (e.g. "Thousand Sons Sorcerer" AND "Exalted Sorcerer" both
  // end with " sorcerer"). Pick the candidate whose non-suffix prefix is used most often
  // across the artifact — that's the faction prefix ("Thousand Sons" × 16) rather than a
  // unit-specific modifier ("Exalted" × 2). Only return if there's a strict winner.
  if (suffixed.length > 1) {
    const normedUnits = units.map(u => norm(u.name))
    const counts = suffixed.map(u => {
      const normName = norm(u.name)
      const prefix = normName.slice(0, normName.length - key.length - 1)
      return normedUnits.filter(n => n.startsWith(`${prefix} `)).length
    })
    const maxCount = Math.max(...counts)
    const winners = suffixed.filter((_, i) => counts[i] === maxCount)
    if (winners.length === 1) return winners[0]
  }

  // Different faction prefix: "Chaos Rhino" exported, "Thousand Sons Rhino" in artifact.
  // Progressively drop leading words from the parsed name and look for a unique tail match.
  // Single-word keys skip this loop entirely and fall through to undefined.
  const words = key.split(' ')
  for (let drop = 1; drop < words.length; drop++) {
    const tail = words.slice(drop).join(' ')
    const tailMatches = units.filter(u => {
      const un = norm(u.name)
      return un === tail || un.endsWith(` ${tail}`)
    })
    if (tailMatches.length === 1) return tailMatches[0]
  }

  return undefined
}

/** Keep only weapons whose normalized name is in the parsed wargear set.
 *  Empty set means no wargear was parsed (format without bullet lines) → pass all through.
 *  BSData names multi-profile weapons with a leading ➤ and a " - <profile>" suffix
 *  (e.g. "➤ Great axe of Khorne - strike"). Army list exports name the weapon without
 *  those decorations, so we also match against the stripped base name. */
function filterWeapons(weapons: Weapon[], wargearSet: Set<string>): Weapon[] {
  if (wargearSet.size === 0) return weapons
  return weapons.filter(w => {
    if (wargearSet.has(norm(w.name))) return true
    if (!w.name.startsWith('➤')) return false
    const base = norm(w.name.replace(/^➤\s*/, '').replace(/\s+-\s+.+$/, ''))
    return wargearSet.has(base)
  })
}

/**
 * Scans every detachment's rules for the BSData convention of granting abilities
 * to all units in your army. BSData uses several phrasings for this — all are
 * semantically equivalent grants:
 *   "units from your army have the following ability"  (Thousand Sons, Emperor's Children)
 *   "units from your army gain the following ability"  (Adeptus Custodes)
 *   "units in your army have the following ability"    (World Eaters)
 *   "models from your army have the following ability" (Aeldari)
 *
 * Returns a map of normalised ability name → the detachment name that grants it.
 * Used at roster-build time to filter abilities that belong to a different detachment.
 *
 * Fallback only: the structural gate (`UnitAbility.detachments`, see
 * {@link isActiveForDetachments}) now covers every ability this prose match catches in the
 * committed data (checked at BSData 951d590). Kept for detachments whose grant is described in
 * prose but not modelled as a BSData `hidden` modifier.
 */
function buildDetachmentAbilityMap(
  detachments: FactionArtifact['detachments'],
): Map<string, string> {
  const map = new Map<string, string>()
  // Matches any of the BSData grant phrasings before "the following abilit(y|ies)"
  const grantTrigger = /(?:units?|models?)\s+(?:from|in)\s+your\s+army\s+(?:have|gain)\s+the\s+following\s+abilit/i
  const abilityName = /\*\*([^*]+)\*\*:/g

  for (const det of detachments) {
    for (const rule of det.rules) {
      if (!grantTrigger.test(rule.effect)) continue
      let match: RegExpExecArray | null
      abilityName.lastIndex = 0
      while ((match = abilityName.exec(rule.effect)) !== null) {
        map.set(norm(match[1]), det.name)
      }
    }
  }

  return map
}

/**
 * Apply an ability's structural detachment gate (`UnitAbility.detachments` /
 * `exceptDetachments`, read from BSData `hidden` modifiers at ingest — see
 * lib/ingest/visibility.ts). An ability gated to detachments shows only while one of them is
 * in the roster; with no detachment matched it is hidden, since it is conditional by
 * construction (e.g. Gloam Rot on Nurgle daemons exists only in a Shadow Legion army).
 */
function isActiveForDetachments(ability: UnitAbility, activeIds: Set<string>): boolean {
  if (ability.detachments && !ability.detachments.some(id => activeIds.has(id))) return false
  if (ability.exceptDetachments?.some(id => activeIds.has(id))) return false
  return true
}

/**
 * Resolve a roster's detachment line to the artifact detachment(s) it names.
 *
 * 11e lists can field several detachments, which exports join onto one line in
 * app-specific ways ("A and B", "A, B", "A + B", …). An exact match is tried first;
 * otherwise every known detachment name found in the line (on word boundaries) is
 * taken, longest first, consuming its span so a shorter name can't re-match inside a
 * longer one. No separator is assumed — whatever sits between the names is ignored —
 * so any export format works, and names containing "and" stay intact. A trailing parenthetical
 * ("Daemonic Incursion (Warp Rifts)") is ignored. Results are in list order.
 */
function resolveDetachments(
  raw: string | undefined,
  detachments: FactionArtifact['detachments'],
): FactionArtifact['detachments'] {
  if (!raw) return []
  const stripParen = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const candidates = [norm(raw), norm(stripParen(raw))]

  const exact = detachments.find(d => candidates.includes(norm(d.name)))
  if (exact) return [exact]

  let remaining = candidates[1]
  const found: { det: FactionArtifact['detachments'][number]; at: number }[] = []
  const byLength = [...detachments].sort((a, b) => b.name.length - a.name.length)
  for (const det of byLength) {
    const name = norm(det.name)
    if (!name) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).exec(remaining)
    if (!m) continue
    const at = m.index + m[1].length
    found.push({ det, at })
    remaining = remaining.slice(0, at) + ' '.repeat(name.length) + remaining.slice(at + name.length)
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.det)
}

function dedupByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(i => {
    const key = norm(i.name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type RosterMeta = {
  factionName: string
  detachment?: string
  points?: number
  stratagems?: Strat[]
  /** The faction's army rule(s), flagged in the glossary at ingest (e.g. Oath of Moment). */
  armyRules: GlossaryRule[]
  /** Rules of the matched detachment(s); empty when no detachment matched. */
  detachmentRules: DetachmentRule[]
  /** Whether `parsed.detachment` resolved to at least one known detachment in the artifact. */
  detachmentMatched: boolean
}

/**
 * Build a phase-keyed Roster from a parsed GW army list and a faction artifact.
 *
 * Phase assignment rules:
 *   - fight    → units that have at least one melee weapon after wargear filtering
 *   - shooting → units that have at least one ranged weapon after wargear filtering
 *   - command / movement / charge / battleshock → every unit, weapons array empty
 *     (non-weapon phases show abilities only)
 *
 * Unrecognized units (no name match) and unrecognized wargear (no weapon match)
 * are silently dropped.
 */
export function buildRoster(
  parsed: ParsedArmy,
  artifact: FactionArtifact,
): { roster: Roster; meta: RosterMeta } {
  const roster: Roster = {}
  const meta: RosterMeta = {
    factionName: artifact.factionName,
    detachment: parsed.detachment,
    points: parsed.totalPoints,
    // Army rules are always-relevant reference, independent of detachment matching.
    armyRules: artifact.glossary.filter(g => g.armyRule),
    detachmentRules: [],
    detachmentMatched: false,
  }

  const matchedDetachments = resolveDetachments(parsed.detachment, artifact.detachments)
  if (matchedDetachments.length > 0) {
    // Union across every detachment in the list (11e armies can field several, e.g.
    // "Changehost of Deceit and Ritual of Regeneration"). Dedupe by name so a rule or
    // stratagem shared between two detachments isn't listed twice.
    meta.stratagems = dedupByName(matchedDetachments.flatMap(d => d.stratagems))
    meta.detachmentRules = dedupByName(matchedDetachments.flatMap(d => d.rules))
    meta.detachmentMatched = true
  }

  // Index the matched detachments' enhancements once per build, so each unit can
  // resolve its army-list enhancement bullets to the full Rule (for the drawer).
  const enhancementsByKey = new Map<string, Rule>()
  for (const enh of matchedDetachments.flatMap(d => d.enhancements ?? [])) {
    enhancementsByKey.set(norm(enh.name), enh)
  }

  // Build a map of abilities that are granted by a specific detachment's rules.
  // When a detachment is matched, abilities belonging to OTHER detachments are
  // filtered out — they don't apply to this army's active detachment(s).
  // If no detachment is matched (unknown/new detachment), filtering is skipped.
  const detachmentAbilityMap = buildDetachmentAbilityMap(artifact.detachments)
  const activeDetachmentNames = new Set(matchedDetachments.map(d => norm(d.name)))
  const activeDetachmentIds = new Set(matchedDetachments.map(d => d.id))

  for (const parsedUnit of parsed.units) {
    const matched = matchUnit(parsedUnit.name, artifact.units)
    if (!matched) continue

    const wargearSet = new Set(parsedUnit.wargear.map(norm))
    const filteredWeapons = filterWeapons(matched.weapons, wargearSet)

    // The v2 structured abilities the card renders: every category except the
    // army-level `faction` rule. The Damaged profile rides on `matched.damaged`,
    // surfaced separately below so it gets its own expanded-card row.
    const unitAbilities = selectUnitAbilities(matched)

    // Fold a plain "Invulnerable Save" ability into the SV stat ("7+, 4++")
    // and drop it from the abilities list — see lib/roster/invulnSave.ts.
    const invulnDigit = findPlainInvulnSave(unitAbilities)
    const baseStats = withInvulnSv(matched.stats, invulnDigit)
    const strippedAbilities = invulnDigit ? stripPlainInvulnSave(unitAbilities) : unitAbilities

    // Drop abilities granted by a different detachment's rule.
    // Only active when the roster's detachment was recognised; if unknown we
    // show everything so no data is silently lost for new / synthesized detachments.
    const gatedAbilities = strippedAbilities.filter(a => isActiveForDetachments(a, activeDetachmentIds))
    const baseAbilities = matchedDetachments.length > 0
      ? gatedAbilities.filter(a => {
          const grantingDetachment = detachmentAbilityMap.get(norm(a.name))
          // Not in the map → unit-native ability, always keep.
          // In the map and granted by an active detachment → keep.
          // In the map but a different detachment → drop.
          return !grantingDetachment || activeDetachmentNames.has(norm(grantingDetachment))
        })
      : gatedAbilities

    // Split parsed enhancement names: those matching a known detachment enhancement
    // become clickable Rule chips; the rest fall back to plain hot chips (covers
    // synthesized detachments and factions with no enhancement coverage yet).
    const enhancements: Rule[] = []
    const unresolvedEnhancements: string[] = []
    for (const name of parsedUnit.enhancements) {
      const rule = enhancementsByKey.get(norm(name))
      if (rule) enhancements.push(rule)
      else unresolvedEnhancements.push(name)
    }

    const base: Unit = {
      id: matched.id,
      name: matched.name,
      role: matched.role,
      models: matched.models,
      stats: baseStats,
      tags: matched.tags,
      // Unit's own hot[] entries plus any enhancement names we couldn't resolve.
      hot: dedup([...matched.hot, ...unresolvedEnhancements]),
      enhancements,
      weapons: filteredWeapons,
      abilities: baseAbilities,
      damaged: matched.damaged,
      stratagems: matched.stratagems,
      reminders: matched.reminders,
    }

    // Pre-compute each ability's relevant phase set once per unit so the
    // per-phase filter below is a cheap Set lookup.
    const abilityPhases = base.abilities.map(a => abilityPhasesFor(a))

    // Themed sub-ability groups (Magnus "Crimson King", Be'lakor "Shadow Form", …)
    // are one cohesive block — the card renders them under a single expandable chip.
    // Filtering their members individually would fragment the group across phase tabs
    // (e.g. "Crimson King" showing 2 of 3 because one member is a Shooting-phase
    // ability). So pool each group's members' relevant phases: a member is kept in a
    // phase whenever ANY member of its group is relevant there, keeping the group whole.
    const groupPhases = new Map<string, Set<PhaseId>>()
    base.abilities.forEach((a, i) => {
      if (!a.group) return
      let phases = groupPhases.get(a.group)
      if (!phases) { phases = new Set(); groupPhases.set(a.group, phases) }
      for (const p of abilityPhases[i]) phases.add(p)
    })

    // The unfiltered datasheet view, attached to every per-phase copy so the
    // expanded card can render the whole profile regardless of phase. Object
    // references are shared across the six copies — no actual duplication.
    const full = {
      stats: base.stats,
      weapons: filteredWeapons,
      abilities: base.abilities,
      damaged: base.damaged,
    }

    /**
     * Build the per-phase copy of this unit: trims stats to the keys consulted
     * in `phase`, drops abilities whose prose doesn't reference the phase
     * (passive abilities pass through every phase via `abilityPhasesFor`), and
     * substitutes the supplied weapons list. `full` is shared across all six
     * copies and powers the expanded-datasheet view.
     */
    const phaseUnit = (phase: PhaseId, weapons: Weapon[]): Unit => ({
      ...base,
      stats: pickStats(base.stats, phase),
      abilities: base.abilities.filter((a, i) => {
        // Grouped abilities ride on their group's pooled phase set so the group
        // stays whole; ungrouped abilities use their own. Leader is hidden
        // everywhere but the command phase (where it's the actionable attach).
        const relevant = a.group
          ? groupPhases.get(a.group)!.has(phase)
          : abilityPhases[i].has(phase)
        return relevant && (phase === 'command' || a.name.toLowerCase() !== 'leader')
      }),
      weapons,
      full,
    })

    // Non-weapon phases: no weapons surfaced, but the unit still appears for
    // its abilities and statline.
    for (const phase of NON_WEAPON_PHASES) {
      roster[phase] = [...(roster[phase] ?? []), phaseUnit(phase, [])]
    }

    // Weapon phases: only include the unit if it has at least one weapon of
    // the matching kind after wargear filtering.
    for (const { phase, kind } of WEAPON_PHASES) {
      const kindWeapons = filteredWeapons.filter(w => w.kind === kind)
      if (kindWeapons.length === 0) continue
      roster[phase] = [...(roster[phase] ?? []), phaseUnit(phase, kindWeapons)]
    }
  }

  return { roster, meta }
}
