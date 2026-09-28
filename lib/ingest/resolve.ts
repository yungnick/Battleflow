import { textOf, type Catalogue, type Profile, type RuleNode } from '../parsers/bsdata'

/**
 * Resolves BSData UUID cross-references (infoLink / entryLink / catalogueLink) so
 * each faction's units become self-contained. Operates on already-parsed trees;
 * fetching/parsing of the catalogue chain happens in the CLI.
 */

// BSData trees are deeply heterogeneous (any element can nest almost anything),
// so the resolver walks them with a permissive node type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BsNode = Record<string, any>

export type BsIndex = Map<string, BsNode>

/**
 * Collect all node IDs belonging to the GST's sharedSelectionEntryGroups subtree.
 * Every node in that subtree is Crusade / narrative-play content (Weapon Modifications,
 * Battle Traits, Battle Scars, Crusade Relics, campaign honours, …) that has no place
 * in a competitive-play reference app. Passing the returned set to buildIndex as a
 * skip-list ensures those nodes are never resolvable during unit traversal — links
 * into the Crusade pools silently return undefined and are ignored.
 */
export function collectCrusadeIds(gst: BsNode): Set<string> {
  const ids = new Set<string>()
  const groups: BsNode[] = [].concat(gst.sharedSelectionEntryGroups?.selectionEntryGroup ?? [])
  const stack: BsNode[] = [...groups]
  while (stack.length) {
    const node = stack.pop()!
    if (!node || typeof node !== 'object') continue
    if (typeof node.id === 'string') ids.add(node.id)
    for (const [key, val] of Object.entries(node)) {
      if (key === 'id' || key === '#text') continue
      if (Array.isArray(val)) {
        for (const c of val) if (c && typeof c === 'object') stack.push(c)
      } else if (val && typeof val === 'object') {
        stack.push(val)
      }
    }
  }
  return ids
}

/**
 * Collect the ids of every rule node defined in the GST's `sharedRules`.
 *
 * These are the edition's **Core** abilities — Deep Strike, Leader, Scouts, Stealth,
 * Lone Operative, Feel No Pain, … — defined once in `Warhammer 40,000.gst` and linked
 * onto datasheets by id. BSData carries no "this is a Core ability" flag; membership in
 * this set IS that signal. (The GST also defines weapon-keyword rules, but those are
 * already dropped upstream by `isWeaponScopedAbility` / `isWeaponKeywordText`, so the
 * remaining unit rule info-links whose target is in this set are exactly the Core ones.)
 *
 * Descends only through rule containers (`sharedRules.rule` / `rules.rule`) so nested rule
 * nodes are caught while the modifiers, conditions and profiles hanging off a rule — which
 * also carry ids — are not, keeping the set to genuine rule ids (its name's contract).
 */
export function collectGstRuleIds(gst: BsNode): Set<string> {
  const ids = new Set<string>()
  const stack: BsNode[] = [].concat(gst.sharedRules?.rule ?? [])
  while (stack.length) {
    const rule = stack.pop()!
    if (!rule || typeof rule !== 'object') continue
    if (typeof rule.id === 'string') ids.add(rule.id)
    // A rule may carry nested rules of its own; follow only those, not arbitrary children.
    for (const nested of [].concat(rule.sharedRules?.rule ?? [], rule.rules?.rule ?? [])) {
      if (nested && typeof nested === 'object') stack.push(nested)
    }
  }
  return ids
}

/**
 * Collect the names of every profile type defined in the GST (`<profileTypes>`).
 *
 * The GST owns the structural profile types — `Unit`, `Ranged Weapons`, `Melee Weapons`,
 * `Abilities`, and `Transport`. Every *themed* ability group (Be'lakor "Shadow Form",
 * Magnus "Crimson King", the Silent King "Triarch Abilities", AM "Orders", …) is instead
 * defined inside a faction catalogue. So "this profile type is a themed group" is exactly
 * "its type is NOT in this set" — the profileType analogue of the Core-rule signal. Used
 * by `normalize` to avoid mis-grouping the structural `Transport` capacity profile (the
 * one GST type that, like `Abilities`, reaches the unit ability stream).
 */
export function collectGstProfileTypes(gst: BsNode): Set<string> {
  const names = new Set<string>()
  for (const pt of gst.profileTypes?.profileType ?? []) {
    if (typeof pt?.name === 'string') names.add(pt.name)
  }
  return names
}

/**
 * Deep-walk parsed trees, indexing every node that carries an `id`.
 * Ids are assumed globally unique across the catalogue chain (they are BSData UUIDs);
 * if the same id appears twice, the last node walked wins.
 * Pass skipIds (from collectCrusadeIds) to exclude Crusade/narrative nodes entirely.
 */
export function buildIndex(roots: BsNode[], skipIds?: Set<string>): BsIndex {
  const index: BsIndex = new Map()
  const stack: BsNode[] = [...roots]
  while (stack.length) {
    const node = stack.pop()!
    if (!node || typeof node !== 'object') continue
    if (typeof node.id === 'string' && !skipIds?.has(node.id)) index.set(node.id, node)
    for (const [key, val] of Object.entries(node)) {
      if (key === 'id' || key === '#text') continue
      if (Array.isArray(val)) {
        for (const c of val) if (c && typeof c === 'object') stack.push(c)
      } else if (val && typeof val === 'object') {
        stack.push(val)
      }
    }
  }
  return index
}

const STAT_TYPES = new Set(['Unit'])
const WEAPON_TYPES = new Set(['Ranged Weapons', 'Melee Weapons'])

/**
 * Option subtrees linked onto units that are army-building choices, NOT datasheet
 * content, and so must not be walked when collecting a unit's profiles:
 *  - Enhancement groups: detachment relics/upgrades a character can buy (e.g. "Sigismund's
 *    Seal", "Phoenix Gem"). BSData names these "<Detachment> Enhancements" (or bare
 *    "Enhancements"); they belong to a detachment, not the datasheet.
 *  - "Crusade": narrative-play progression (battle honours, relics, scars).
 * Without pruning, `collectUnit` sweeps these whole pools into every eligible unit's
 * abilities — observed as a median of ~28 spurious abilities per unit, most belonging
 * to other datasheets. Matched by the group's canonical (English) name, like the
 * typeName sets above. (Enhancements get their own home once detachments are extracted.)
 */
export function isPrunedOption(name: string | undefined): boolean {
  if (!name) return false
  return name === 'Crusade' || name === 'Enhancements' || name.endsWith(' Enhancements')
}

function isAbilityProfile(p: Profile): boolean {
  return !STAT_TYPES.has(p.typeName) && !WEAPON_TYPES.has(p.typeName)
}

// Weapon keyword descriptions carry "this weapon" or "weapons with [KEYWORD]" in their text.
// They are weapon-scoped rules, not unit abilities, and must be dropped — they would otherwise
// leak onto every unit that links to a shared weapon-keywords infoGroup.
function isWeaponKeywordText(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('this weapon') || t.startsWith('weapons with [') || t.startsWith('weapons with **[')
}

function isWeaponScopedAbility(p: Profile): boolean {
  const desc = (p.characteristics?.characteristic ?? []).find((c) => c.name === 'Description')
  return isWeaponKeywordText(desc?.['#text'] ?? '')
}

export interface ResolvedUnit {
  bsId: string
  name: string
  statProfile?: Profile
  weapons: Profile[]
  abilities: Profile[]
  rules: RuleNode[]
  /**
   * Non-weapon-scoped rule infoLinks with their modifier-resolved display names.
   * `core` is true when the linked rule is defined in the GST `sharedRules` (an edition
   * Core ability — see {@link collectGstRuleIds}); `normalize` uses it to classify.
   */
  unitRules: Array<{ name: string; effect: string; core: boolean }>
  keywords: string[]
  points?: string
}

function hasWeaponProfiles(node: BsNode): boolean {
  return (node.profiles?.profile ?? []).some((p: Profile) => WEAPON_TYPES.has(p.typeName))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyNameModifiers(base: string, modifiers: any[]): string {
  let name = base
  for (const mod of modifiers) {
    if (mod.field === 'name' && mod.type === 'append') name += ' ' + mod.value
  }
  return name
}

function hasUnitProfile(node: BsNode, index: BsIndex, seen = new Set<string>(), depth = 0): boolean {
  if (!node || depth > 8) return false
  for (const p of node.profiles?.profile ?? []) if (STAT_TYPES.has(p.typeName)) return true
  // Stat profiles may also be shared and pulled in by reference (11e Codex: Orks does this
  // for Nobz / Meganobz / Tankbustas, whose model entries infoLink a shared "Unit" profile).
  for (const l of node.infoLinks?.infoLink ?? []) {
    if (l.type !== 'profile') continue
    const t = index.get(l.targetId) as Profile | undefined
    if (t && STAT_TYPES.has(t.typeName)) return true
  }
  for (const l of node.entryLinks?.entryLink ?? []) {
    if (seen.has(l.targetId)) continue
    seen.add(l.targetId)
    const t = index.get(l.targetId)
    if (t && hasUnitProfile(t, index, seen, depth + 1)) return true
  }
  for (const e of node.selectionEntries?.selectionEntry ?? []) if (hasUnitProfile(e, index, seen, depth + 1)) return true
  for (const g of node.selectionEntryGroups?.selectionEntryGroup ?? []) if (hasUnitProfile(g, index, seen, depth + 1)) return true
  return false
}

/**
 * Enumerate fieldable datasheets across one or more catalogues. Candidate roots are
 * each catalogue's top-level entryLinks (the roster-selectable entries) plus any
 * directly-defined top-level selectionEntries; we keep those that resolve to an entry
 * carrying a Unit stat profile, deduped by resolved entry id. Passing the faction's
 * imported catalogues (those linked with importRootEntries) surfaces allied/shared
 * datasheets exactly as a roster builder would offer them.
 */
export function enumerateUnits(
  catalogues: Catalogue[],
  index: BsIndex,
  coreRuleIds: Set<string> = new Set(),
): ResolvedUnit[] {
  const roots: { node: BsNode; linkFactions: string[] }[] = []
  const seenRoot = new Set<string>()

  const consider = (node: BsNode | undefined, link?: BsNode) => {
    if (!node || typeof node.id !== 'string' || seenRoot.has(node.id)) return
    if (!hasUnitProfile(node, index)) return
    seenRoot.add(node.id)
    const linkFactions = (link?.categoryLinks?.categoryLink ?? [])
      .map((c: { name?: string }) => c.name ?? '')
      .filter((n: string) => n.startsWith('Faction: '))
    roots.push({ node, linkFactions })
  }

  for (const cat of catalogues) {
    for (const link of cat.entryLinks?.entryLink ?? []) consider(index.get(link.targetId), link)
    for (const entry of cat.selectionEntries?.selectionEntry ?? []) consider(entry)
  }

  return roots.map(({ node, linkFactions }) => {
    const unit = collectUnit(node, index, coreRuleIds)
    // BattleScribe lets the root entryLink carry categories for the linked entry. Some shared
    // entries (e.g. Agents of the Imperium's Legends Kill Teams) tag "Faction: X" only there;
    // without it they'd look faction-agnostic and pass every Imperium faction's filter.
    if (!unit.keywords.some((k) => k.startsWith('Faction: '))) unit.keywords.push(...linkFactions)
    return unit
  })
}

/**
 * Walk a unit subtree, resolving links, gathering its stat/weapon/ability/rule nodes.
 * `coreRuleIds` (the GST `sharedRules` id set) tags each unit rule as Core or not.
 */
function collectUnit(root: BsNode, index: BsIndex, coreRuleIds: Set<string> = new Set()): ResolvedUnit {
  const unit: ResolvedUnit = {
    bsId: root.id,
    name: root.name ?? '(unnamed)',
    weapons: [],
    abilities: [],
    rules: [],
    unitRules: [],
    keywords: [],
  }
  const weaponIds = new Set<string>()
  const abilityIds = new Set<string>()
  const ruleIds = new Set<string>()
  const unitRuleIds = new Set<string>()
  const visited = new Set<string>()

  // Keywords + points come from the root datasheet node only (canonical).
  for (const c of root.categoryLinks?.categoryLink ?? []) {
    if (c.name && !unit.keywords.includes(c.name)) unit.keywords.push(c.name)
  }
  const pts = (root.costs?.cost ?? []).find((c: { name: string; value: string }) => c.name === 'pts')
  if (pts) unit.points = pts.value

  const addProfile = (p: Profile) => {
    if (STAT_TYPES.has(p.typeName)) {
      if (!unit.statProfile) unit.statProfile = p
    } else if (WEAPON_TYPES.has(p.typeName)) {
      if (!weaponIds.has(p.id)) { weaponIds.add(p.id); unit.weapons.push(p) }
    } else if (isAbilityProfile(p) && !isWeaponScopedAbility(p)) {
      if (!abilityIds.has(p.id)) { abilityIds.add(p.id); unit.abilities.push(p) }
    }
  }
  const addRule = (r: RuleNode) => {
    if (r?.id && !ruleIds.has(r.id)) { ruleIds.add(r.id); unit.rules.push(r) }
  }

  const traverse = (node: BsNode | undefined, depth: number) => {
    if (!node || depth > 12) return

    for (const p of node.profiles?.profile ?? []) addProfile(p)

    for (const l of node.infoLinks?.infoLink ?? []) {
      const target = index.get(l.targetId)
      if (!target) continue
      if (l.type === 'rule') {
        addRule(target as RuleNode)
        if (!hasWeaponProfiles(node) && !unitRuleIds.has(target.id)) {
          const effect = textOf((target as RuleNode).description)
          if (isWeaponKeywordText(effect)) continue
          unitRuleIds.add(target.id)
          const name = applyNameModifiers(l.name ?? (target as RuleNode).name, l.modifiers?.modifier ?? [])
          unit.unitRules.push({ name, effect, core: coreRuleIds.has(target.id) })
        }
      }
      else if (l.type === 'profile') addProfile(target as Profile)
      else if (l.type === 'infoGroup') {
        if (visited.has(l.targetId)) continue
        visited.add(l.targetId)
        traverse(target, depth + 1)
      }
    }

    for (const l of node.entryLinks?.entryLink ?? []) {
      if (isPrunedOption(l.name)) continue
      const target = index.get(l.targetId)
      if (!target || visited.has(l.targetId)) continue
      visited.add(l.targetId)
      traverse(target, depth + 1)
    }

    for (const e of node.selectionEntries?.selectionEntry ?? []) {
      if (isPrunedOption(e.name)) continue
      traverse(e, depth + 1)
    }
    for (const g of node.selectionEntryGroups?.selectionEntryGroup ?? []) {
      if (isPrunedOption(g.name)) continue
      traverse(g, depth + 1)
    }
  }

  traverse(root, 0)
  return unit
}
