/**
 * Ingest normalization: converts BSData resolved units into `FactionArtifact` shape.
 *
 * Schemas are defined in `lib/schemas.ts` (the single source of truth); this module
 * re-exports the ones that the rest of the ingest pipeline (`emit.ts`, tests) import,
 * so those callers need no path changes. Only `toFactionArtifact()` and its
 * BSData-specific helpers live here.
 */

// Re-export schemas so ingest consumers keep `import ... from './normalize'` unchanged.
export {
  FactionArtifactSchema,
  DataManifestSchema,
  SharedDetachmentSetSchema,
  ManifestFactionSchema,
} from '../schemas'

import { textOf, type Catalogue, type Profile } from '../parsers/bsdata'
import { ARMY_RULES, flagArmyRules } from './armyRules'
import { attachArmyRuleOptions } from './armyRuleOptions'
import { norm } from '../roster/normalize'
import type { ResolvedUnit } from './resolve'
import type { AbilityGate } from './visibility'
import {
  DATA_SCHEMA_VERSION,
  FactionArtifactSchema,
  type Detachment,
  type FactionArtifact,
  type GlossaryRule,
  type PreparedUnit,
  type UnitAbility,
} from '../schemas'
import type { Stats, Weapon, Rule } from '../types'

// ---------------------------------------------------------------------------
// BSData-specific helpers (ingest-only, not exported)
// ---------------------------------------------------------------------------

/** Priority order for picking a single display "role" from a unit's keywords. */
const ROLE_KEYWORDS = [
  'Epic Hero', 'Character', 'Battleline', 'Dedicated Transport', 'Infantry',
  'Mounted', 'Beast', 'Swarm', 'Vehicle', 'Walker', 'Monster', 'Aircraft',
  'Fortification', 'Titanic',
]

function statsFromProfile(p: Profile, exclude: Set<string> = new Set()): Stats {
  const stats: Stats = {}
  for (const c of p.characteristics?.characteristic ?? []) {
    if (exclude.has(c.name)) continue
    stats[c.name] = c['#text'] ?? ''
  }
  return stats
}

function weaponFromProfile(p: Profile): Weapon {
  const keywords = (p.characteristics?.characteristic ?? []).find((c) => c.name === 'Keywords')
  const tags = (keywords?.['#text'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && t !== '-')
  return {
    name: p.name,
    kind: p.typeName === 'Ranged Weapons' ? 'ranged' : 'melee',
    stats: statsFromProfile(p, new Set(['Keywords'])),
    tags,
    mods: [],
  }
}

function abilityFromProfile(p: Profile, source: string): Rule {
  const chars = p.characteristics?.characteristic ?? []
  const description = chars.find((c) => c.name === 'Description')
  const effect = description?.['#text'] ?? chars.map((c) => `${c.name}: ${c['#text'] ?? ''}`).join('; ')
  return { name: p.name, timing: '', effect, source }
}

function deriveRole(keywords: string[]): string {
  return ROLE_KEYWORDS.find((r) => keywords.includes(r)) ?? ''
}

/** The generic ability profile type. Anything else (and not GST-structural) is a themed group. */
const GENERIC_ABILITY_TYPE = 'Abilities'

/** Matches BSData's "Damaged: N-M wounds remaining" degrading-profile ability by name. */
function isDamagedProfile(name: string): boolean {
  return /^damaged:/i.test(name.trim())
}

/**
 * Classify a unit's abilities into the printed-card taxonomy and preserve themed groups.
 *
 * Inputs are the two ability streams BSData exposes on a resolved unit:
 *  - `unitRules` — rule info-links, each pre-tagged `core` when defined in the GST.
 *  - `abilities` — ability *profiles*, each carrying its BSData `profileType` (`typeName`).
 *
 * Classification:
 *  - **core**     — a `unitRule` with `core === true`.
 *  - **faction**  — any ability (rule or profile) whose name matches the faction's army
 *                   rule(s) in `ARMY_RULES`. Kept for fidelity; `buildRoster` drops it from
 *                   per-unit rendering (it lives in the army-level section) — fixing the
 *                   double-show where the army rule leaked onto every unit.
 *  - **datasheet**— everything else.
 *
 * Themed groups: a profile whose `typeName` is neither the generic `Abilities` nor a
 * GST-defined structural type (e.g. `Transport`) is a sub-ability of a themed group named
 * by that type. A same-named generic ability, when present, is the group's parent and is
 * folded into `groupBlurb` rather than rendered as its own chip.
 *
 * The separated "Damaged" profile is returned out-of-band so the caller can route it to
 * `PreparedUnit.damaged`.
 *
 * De-dup mirrors the previous single-pass behaviour: the concatenated list (core → faction
 * → datasheet) is keyed by `name|effect` (plus any detachment gate), so an ability reachable
 * via two paths — e.g. "Leader" as both a Core rule and a profile — collapses to one entry,
 * keeping the earliest (best-classified) copy.
 */
function buildUnitAbilities(
  u: ResolvedUnit,
  factionName: string,
  factionId: string,
  gstProfileTypes: Set<string>,
): { abilities: UnitAbility[]; damaged?: Rule } {
  const armyRuleNames = new Set((ARMY_RULES[factionId] ?? []).map(norm))
  const isFactionName = (name: string) => armyRuleNames.has(norm(name))
  const isGroupType = (typeName: string) =>
    typeName !== GENERIC_ABILITY_TYPE && !gstProfileTypes.has(typeName)

  // Generic ("Abilities"-typed) profiles indexed by name → effect, so a themed group can
  // borrow its same-named parent ability's text as the group blurb.
  const parentBlurbs = new Map<string, string>()
  for (const p of u.abilities) {
    if (p.typeName === GENERIC_ABILITY_TYPE) {
      parentBlurbs.set(norm(p.name), abilityFromProfile(p, factionName).effect)
    }
  }
  // Names of the themed groups present on this unit — used to drop their parent ability
  // from the flat list (it survives only as the group's blurb).
  const groupNamesOnUnit = new Set(
    u.abilities.filter((p) => isGroupType(p.typeName)).map((p) => norm(p.typeName)),
  )
  // Groups whose blurb has already been attached — the blurb rides on each group's first
  // child only (not repeated on every member), so the artifact stores it once.
  const blurbedGroups = new Set<string>()

  const core: UnitAbility[] = []
  const faction: UnitAbility[] = []
  const datasheet: UnitAbility[] = []
  let damaged: Rule | undefined

  // Core / faction / datasheet abilities sourced from rule info-links.
  for (const { name, effect, core: isCore, gate } of u.unitRules) {
    const base = { name, timing: '', effect, source: factionName, ...gateFields(gate) }
    if (isFactionName(name)) faction.push({ ...base, category: 'faction' })
    else if (isCore) core.push({ ...base, category: 'core' })
    else datasheet.push({ ...base, category: 'datasheet' })
  }

  // Datasheet (and faction) abilities sourced from ability profiles.
  for (const p of u.abilities) {
    if (isDamagedProfile(p.name)) {
      if (!damaged) damaged = abilityFromProfile(p, factionName)
      continue
    }
    const base = { ...abilityFromProfile(p, factionName), ...gateFields(u.abilityGates?.get(p.id)) }
    if (isFactionName(p.name)) {
      faction.push({ ...base, category: 'faction' })
    } else if (isGroupType(p.typeName)) {
      const key = norm(p.typeName)
      const blurb = blurbedGroups.has(key) ? undefined : parentBlurbs.get(key)
      if (blurb) blurbedGroups.add(key)
      datasheet.push({ ...base, category: 'datasheet', group: p.typeName, ...(blurb ? { groupBlurb: blurb } : {}) })
    } else {
      // Generic ability. Skip the ones that are only a themed group's parent blurb.
      if (groupNamesOnUnit.has(norm(p.name))) continue
      datasheet.push({ ...base, category: 'datasheet' })
    }
  }

  // The gate is part of the key, so a detachment-gated copy can't swallow an ungated one.
  const abilities = dedupeBy(
    [...core, ...faction, ...datasheet],
    (a) => `${a.name}|${a.effect}|${a.detachments?.join(',') ?? ''}|${a.exceptDetachments?.join(',') ?? ''}`,
  )
  return { abilities, ...(damaged ? { damaged } : {}) }
}

/** Spread a resolved ability's detachment gate onto its `UnitAbility` (nothing when ungated). */
function gateFields(gate: AbilityGate | undefined): Pick<UnitAbility, 'detachments' | 'exceptDetachments'> {
  if (!gate) return {}
  return 'detachments' in gate ? { detachments: gate.detachments } : { exceptDetachments: gate.exceptDetachments }
}

/**
 * Dedupe by a content key, not just name — two distinct profiles can share a display
 * name (e.g. wargear reached via multiple option paths) yet differ in stats/effect, and
 * keying on name alone would silently drop one.
 */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a resolved BSData catalogue + units into a validated `FactionArtifact`.
 * This is the final step of the BSData ingest pipeline; the artifact is then
 * serialized and written to `public/data/factions/<id>.json` by `emit.ts`.
 */
export function toFactionArtifact(
  faction: Catalogue,
  resolved: ResolvedUnit[],
  factionId: string,
  factionKeywords: string[],
  detachments: Detachment[] = [],
  gstProfileTypes: Set<string> = new Set(),
): FactionArtifact {
  const factionName = faction.name
  const glossaryMap = new Map<string, GlossaryRule>()

  const units: PreparedUnit[] = resolved.map((u) => {
    // Collect rules from each unit into the faction-level glossary (deduped by id).
    for (const rule of u.rules) {
      if (!glossaryMap.has(rule.id)) {
        glossaryMap.set(rule.id, {
          id: rule.id,
          name: rule.name,
          timing: '',
          effect: textOf(rule.description),
          source: factionName,
        })
      }
    }

    const stats = u.statProfile ? statsFromProfile(u.statProfile) : undefined

    // Classify abilities (core / faction / datasheet), preserve themed groups, and split
    // out the Damaged profile (see buildUnitAbilities).
    const { abilities, damaged } = buildUnitAbilities(u, factionName, factionId, gstProfileTypes)

    const unit: PreparedUnit = {
      id: u.bsId,
      bsId: u.bsId,
      name: u.name,
      role: deriveRole(u.keywords),
      models: 1,
      tags: u.keywords,
      hot: [],
      weapons: dedupeBy(u.weapons.map(weaponFromProfile), (w) => `${w.kind}|${w.name}|${JSON.stringify(w.stats)}`),
      abilities,
      stratagems: [],
      reminders: [],
      keywords: u.keywords,
      ruleRefs: u.rules.map((r) => r.id),
    }
    if (stats && Object.keys(stats).length) unit.stats = stats
    if (damaged) unit.damaged = damaged
    const points = u.points != null ? Number(u.points) : NaN
    if (!Number.isNaN(points)) unit.points = points
    return unit
  })

  const artifact: FactionArtifact = {
    schemaVersion: DATA_SCHEMA_VERSION,
    factionId,
    factionName,
    bsCatalogueId: faction.id,
    factionKeywords,
    detachments,
    units,
    glossary: [...glossaryMap.values()],
  }

  // Tag the faction's army rule(s) in the glossary from the curated allowlist, so
  // future ingests carry the flag automatically (see lib/ingest/armyRules.ts).
  flagArmyRules(artifact)

  // Attach any faction-wide reference table (Rituals / Blessings of Khorne) an army rule
  // points players at — extracted from a standalone selectionEntry that enumerateUnits
  // never walks (see lib/ingest/armyRuleOptions.ts).
  attachArmyRuleOptions(artifact, faction)

  // Parse validates the artifact shape and strips any unknown fields.
  return FactionArtifactSchema.parse(artifact) as FactionArtifact
}
