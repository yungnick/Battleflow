import type { Catalogue, EntryLink, InfoLink, Profile, RuleNode, SelectionEntry, SelectionEntryGroup } from '../parsers/bsdata'
import { textOf } from '../parsers/bsdata'
import { buildIndex, isPrunedOption, type BsIndex } from './resolve'
import { FORCE_DISPOSITIONS, type Detachment, type DetachmentRule, type Enhancement } from '../dataModel'
import { norm } from '../roster/normalize'
import type { Strat } from '../types'

type ForceDisposition = (typeof FORCE_DISPOSITIONS)[number]

const STRATAGEM_TYPE = 'Stratagem'

/**
 * BSData typeName values that indicate detachment ability profiles.
 * Note: BSData 10e uses "Abilities" (plural) for all ability profiles — earlier
 * versions used "Ability" (singular). Both are included for compatibility.
 */
const ABILITY_TYPES = new Set(['Ability', 'Abilities', 'Detachment Ability', 'Enhancement'])

/** Parse an integer CP cost from strings like "1 CP", "2CP", "1". */
function parseCp(raw: string | undefined): number {
  if (!raw) return 1
  const m = raw.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}

/** Infer usage restriction from effect/restriction text. */
function parseOnce(text: string): 'battle' | 'phase' | false {
  const t = text.toLowerCase()
  if (t.includes('once per battle') || t.includes('more than once per battle')) return 'battle'
  if (t.includes('once per phase') || t.includes('once per turn')) return 'phase'
  return false
}

/**
 * Extract a short tactical summary from a stratagem's full effect text.
 * Prefers the EFFECT: section when the text is structured; falls back to first sentence.
 */
function extractSummary(effect: string): string {
  const effectMatch = effect.match(/EFFECT:\s*([\s\S]+?)(?=\n[A-Z ]+:|$)/i)
  const raw = effectMatch ? effectMatch[1].trim() : effect.trim()
  const breakIdx = raw.search(/[.!]\s/)
  const first = breakIdx >= 0 ? raw.slice(0, breakIdx + 1) : raw
  const clean = first.replace(/\n/g, ' ').trim()
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean
}

/** Get a characteristic value by one of several candidate names. */
function charValue(profile: Profile, ...names: string[]): string {
  for (const c of profile.characteristics?.characteristic ?? []) {
    if (names.includes(c.name)) return c['#text'] ?? ''
  }
  return ''
}

function stratagemFromProfile(profile: Profile, source: string): Strat {
  const effect = charValue(profile, 'Description', 'Effect', 'Summary')
  const restriction = charValue(profile, 'Restriction', 'Restrictions')
  const combinedText = [effect, restriction].filter(Boolean).join(' ')
  return {
    name: profile.name,
    cp: parseCp(charValue(profile, 'Cost', 'CP')),
    timing: charValue(profile, 'Type', 'When', 'Phase'),
    effect,
    cond: restriction || undefined,
    once: parseOnce(combinedText),
    source,
    summary: extractSummary(effect || combinedText),
  }
}

function detachmentRuleFromProfile(profile: Profile, source: string): DetachmentRule {
  const chars = profile.characteristics?.characteristic ?? []
  const desc = chars.find(c => c.name === 'Description' || c.name === 'Effect')
  const effect = desc?.['#text'] ?? chars.map(c => `${c.name}: ${c['#text'] ?? ''}`).join('; ')
  return {
    id: profile.id,
    name: profile.name,
    timing: charValue(profile, 'Type', 'When', 'Phase'),
    effect,
    source,
  }
}

function detachmentRuleFromRuleNode(rule: RuleNode, source: string): DetachmentRule {
  return {
    id: rule.id,
    name: rule.name,
    timing: '',
    effect: textOf(rule.description),
    source,
  }
}

/**
 * A permissive node type for traversal — BSData subtrees are heterogeneous
 * (SelectionEntry, SelectionEntryGroup, EntryLink all share nested children).
 */
interface BsDataNode {
  profiles?: { profile?: Profile[] }
  rules?: { rule?: RuleNode[] }
  infoLinks?: { infoLink?: InfoLink[] }
  entryLinks?: { entryLink?: EntryLink[] }
  selectionEntries?: { selectionEntry?: SelectionEntry[] }
  selectionEntryGroups?: { selectionEntryGroup?: SelectionEntryGroup[] }
}

/**
 * Walk a single detachment entry's subtree, collecting stratagem profiles,
 * ability profiles, and rule nodes.
 *
 * BSData 10e uses three patterns for detachment rules:
 * - Space Marines: profiles with typeName="Abilities" directly on the entry
 * - Necrons: infoLinks with type="rule" pointing to rule nodes in the index
 * - T'au: rule nodes embedded directly under <rules> on the entry
 *
 * Does NOT recurse into nested selectionEntry/selectionEntryGroup children —
 * individual detachment entries are treated as leaf nodes so each detachment's
 * content stays separate.
 */
function collectDetachmentContent(
  node: BsDataNode,
  index: BsIndex,
  stratagems: Profile[],
  abilities: Profile[],
  ruleNodes: RuleNode[],
  seenIds: Set<string>,
  depth = 0,
): void {
  if (depth > 4) return

  for (const p of node.profiles?.profile ?? []) {
    if (seenIds.has(p.id)) continue
    seenIds.add(p.id)
    if (p.typeName === STRATAGEM_TYPE) stratagems.push(p)
    else if (ABILITY_TYPES.has(p.typeName)) abilities.push(p)
  }

  for (const r of node.rules?.rule ?? []) {
    if (!r.id || seenIds.has(r.id)) continue
    seenIds.add(r.id)
    ruleNodes.push(r)
  }

  for (const link of node.infoLinks?.infoLink ?? []) {
    if (seenIds.has(link.targetId)) continue
    seenIds.add(link.targetId)
    const target = index.get(link.targetId)
    if (!target) continue
    if (link.type === 'rule' || !('typeName' in target)) {
      ruleNodes.push(target as RuleNode)
    } else {
      const profile = target as Profile
      if (profile.typeName === STRATAGEM_TYPE) stratagems.push(profile)
      else if (profile.typeName && ABILITY_TYPES.has(profile.typeName)) abilities.push(profile)
    }
  }

  for (const l of node.entryLinks?.entryLink ?? []) {
    if (seenIds.has(l.targetId)) continue
    seenIds.add(l.targetId)
    const target = index.get(l.targetId) as BsDataNode | undefined
    if (target) collectDetachmentContent(target, index, stratagems, abilities, ruleNodes, seenIds, depth + 1)
  }
}

/** Detachment Points cost (11e) — a real BSData `Cost` entry, read the same way `pts` is. */
function detachmentDpCost(entry: SelectionEntry): number | undefined {
  const cost = entry.costs?.cost?.find(c => c.name === 'Detachment Points')
  if (!cost) return undefined
  const value = Number(cost.value)
  return Number.isNaN(value) ? undefined : value
}

/**
 * Force Disposition (11e) — structural via `categoryLinks`: every detachment carries exactly
 * one of the GST's five Force Disposition names as a category link. Warns loudly (not a
 * silent no-op) on a miss, since every 11e detachment should have one — a miss means the
 * GST's Force Disposition group changed shape.
 */
function detachmentForceDisposition(entry: SelectionEntry): ForceDisposition | undefined {
  const dispositions: readonly string[] = FORCE_DISPOSITIONS
  const link = entry.categoryLinks?.categoryLink?.find(c => dispositions.includes(c.name))
  if (!link) {
    console.warn(`  ⚠ detachment "${entry.name}" has no Force Disposition categoryLink`)
    return undefined
  }
  return link.name as ForceDisposition
}

function entryToDetachment(entry: SelectionEntry, index: BsIndex): Detachment | null {
  const stratProfiles: Profile[] = []
  const abilityProfiles: Profile[] = []
  const ruleNodes: RuleNode[] = []
  const seenIds = new Set<string>([entry.id])

  collectDetachmentContent(entry, index, stratProfiles, abilityProfiles, ruleNodes, seenIds)

  if (stratProfiles.length === 0 && abilityProfiles.length === 0 && ruleNodes.length === 0) return null

  const nameSeen = new Set<string>()
  const dedup = <T extends { name: string }>(arr: T[]): T[] => arr.filter(item => {
    if (nameSeen.has(item.name)) return false
    nameSeen.add(item.name)
    return true
  })

  const rules: DetachmentRule[] = [
    ...dedup(abilityProfiles).map(p => detachmentRuleFromProfile(p, entry.name)),
    ...dedup(ruleNodes).map(r => detachmentRuleFromRuleNode(r, entry.name)),
  ]

  const dpCost = detachmentDpCost(entry)
  const forceDisposition = detachmentForceDisposition(entry)

  return {
    id: entry.id,
    name: entry.name,
    stratagems: dedup(stratProfiles).map(p => stratagemFromProfile(p, entry.name)),
    rules,
    ...(dpCost != null ? { dpCost } : {}),
    ...(forceDisposition ? { forceDisposition } : {}),
  }
}

/**
 * Collect a catalogue's individual detachment `selectionEntry`s.
 *
 * BSData 10e stores detachments in three structural patterns depending on the faction:
 *
 * Pattern A (Space Marines): sharedSelectionEntryGroups["Detachment"] whose direct
 *   selectionEntry children are individual detachments with Abilities profiles.
 *
 * Pattern B (Necrons): sharedSelectionEntries["Detachment Choice"] containing a nested
 *   selectionEntryGroups["Detachment"] whose children are individual detachments with
 *   infoLinks to rule nodes.
 *
 * Pattern C (T'au): sharedSelectionEntries["Detachment"] with an entryLink to a
 *   selectionEntryGroup["Detachment"] (resolved via the index) whose children are
 *   individual detachments with embedded rule nodes.
 */
function detachmentEntriesOf(cat: Catalogue, index: BsIndex): SelectionEntry[] {
  const entries: SelectionEntry[] = []
  const seen = new Set<string>()
  const add = (entry: SelectionEntry) => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    entries.push(entry)
  }
  const group = (seg: SelectionEntryGroup) => {
    for (const entry of seg.selectionEntries?.selectionEntry ?? []) add(entry)
  }

  // Pattern A: sharedSelectionEntryGroups named "Detachment" (Space Marines)
  for (const seg of cat.sharedSelectionEntryGroups?.selectionEntryGroup ?? []) {
    if (seg.name.toLowerCase().includes('detachment')) group(seg)
  }

  // Patterns B & C: sharedSelectionEntries whose name includes "detachment"
  for (const entry of cat.sharedSelectionEntries?.selectionEntry ?? []) {
    if (!entry.name.toLowerCase().includes('detachment')) continue

    // Pattern B (Necrons): entry has a nested selectionEntryGroups["Detachment"]
    const nestedGroup = (entry.selectionEntryGroups?.selectionEntryGroup ?? [])
      .find(g => g.name.toLowerCase().includes('detachment'))
    if (nestedGroup) {
      group(nestedGroup)
      continue
    }

    // Pattern C (T'au): entry has an entryLink to a selectionEntryGroup named "Detachment"
    let resolvedViaLink = false
    for (const link of entry.entryLinks?.entryLink ?? []) {
      if (link.type !== 'selectionEntryGroup') continue
      const target = index.get(link.targetId) as SelectionEntryGroup | undefined
      if (!target || !target.name?.toLowerCase().includes('detachment')) continue
      group(target)
      resolvedViaLink = true
    }

    // Fallback: treat the entry itself as a single detachment
    if (!resolvedViaLink) add(entry)
  }

  return entries
}

function enhancementFromEntry(entry: SelectionEntry, source: string): Enhancement {
  const profile = entry.profiles?.profile?.[0]
  const effect = profile ? charValue(profile, 'Description', 'Effect') : ''
  return { name: entry.name, timing: '', effect, source }
}

/** Strip combining diacritics (e.g. Leagues of Votann's "Needgaârd" vs the enhancement
 * comment's plain-ASCII "Needgaard") so name matching isn't defeated by GW's stylized spelling. */
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Lowercase alphanumeric word-token set, diacritic- and punctuation-insensitive. */
function wordTokens(s: string): Set<string> {
  return new Set(norm(foldDiacritics(s)).split(/[^a-z0-9]+/).filter(Boolean))
}

function isSubsetOf(sub: Set<string>, sup: Set<string>): boolean {
  for (const x of sub) if (!sup.has(x)) return false
  return true
}

export interface EnhancementGroup {
  comment: string
  enhancements: Enhancement[]
  /** BSData entry ids the group's visibility conditions reference (see {@link conditionChildIds}). */
  referencedIds?: Set<string>
}

/**
 * Every `childId` referenced by an entry's modifier conditions. An enhancement is hidden unless
 * its detachment is selected, so these include the owning detachment's entry id — a structural
 * tie-breaker when the free-text `comment` names more than one detachment.
 */
function conditionChildIds(entry: SelectionEntry): Set<string> {
  const ids = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const childId = (node as { childId?: unknown }).childId
    if (typeof childId === 'string') ids.add(childId)
    for (const v of Object.values(node)) walk(v)
  }
  walk(entry.modifiers)
  walk((entry as { modifierGroups?: unknown }).modifierGroups)
  return ids
}

/**
 * Extract 11e enhancements from a faction's owned catalogues (BSData structural data —
 * confirmed in the Phase 1 spike; previously scraped from Wahapedia). Every faction
 * catalogue carries one or more `sharedSelectionEntryGroups` named "Enhancements" (bare, or
 * "\<X\> Enhancements" — the same option-subtree names `isPrunedOption` already excludes from
 * unit ability collection in `resolve.ts`), each holding individual enhancement
 * `selectionEntry`s. BSData uses two different structural patterns to name the owning
 * detachment, observed across factions in the full-catalogue run:
 *
 *  - Necrons-style: one bare "Enhancements" pool shared by every detachment, disambiguated
 *    per entry via a `comment` field ("Awakened Dynasty", or a short distinguishing keyword
 *    like "Zealots" for "Pactbound Zealots" — {@link matchEnhancementGroups} resolves either).
 *  - Space Marines-style: one group per detachment, named "\<Detachment\> Enhancements"
 *    (e.g. "Gladius Task Force Enhancements"), whose entries carry no `comment` at all — the
 *    group name already names the detachment, so it's used as the fallback owner.
 *
 * `comment: null` on a bare "Enhancements" pool entry (no group-name fallback available)
 * means genuinely unlisted/Legends content — logged and skipped, not silently dropped.
 */
export function extractEnhancements(ownedCatalogues: Catalogue[]): EnhancementGroup[] {
  const byOwner = new Map<string, Enhancement[]>()
  const refsByOwner = new Map<string, Set<string>>()
  for (const cat of ownedCatalogues) {
    for (const group of cat.sharedSelectionEntryGroups?.selectionEntryGroup ?? []) {
      if (!isPrunedOption(group.name)) continue
      // A "<Detachment> Enhancements" group already names its detachment; only the bare
      // "Enhancements" pool needs the per-entry `comment` to disambiguate.
      const groupOwner = group.name === 'Enhancements' ? undefined : group.name.replace(/ Enhancements$/, '')
      for (const entry of group.selectionEntries?.selectionEntry ?? []) {
        const owner = entry.comment ?? groupOwner
        if (!owner) {
          console.warn(`  ⚠ enhancement "${entry.name}" has no owning-detachment comment — skipped (Legends/unlisted content?)`)
          continue
        }
        const list = byOwner.get(owner) ?? []
        list.push(enhancementFromEntry(entry, owner))
        byOwner.set(owner, list)
        const refs = refsByOwner.get(owner) ?? new Set<string>()
        for (const id of conditionChildIds(entry)) refs.add(id)
        refsByOwner.set(owner, refs)
      }
    }
  }
  return [...byOwner.entries()].map(([comment, enhancements]) => ({
    comment,
    enhancements,
    referencedIds: refsByOwner.get(comment),
  }))
}

/**
 * Resolve each enhancement group's `comment` to exactly one of `detachments`, mutating
 * matched detachments' `enhancements` in place. A group matches a detachment when the
 * comment's word tokens are a subset of the detachment name's word tokens (diacritic- and
 * punctuation-insensitive) — e.g. comment "Siege-host" matches "Fellhammer Siege-host".
 * Matching is GLOBAL (every group is checked against every detachment) rather than
 * first-match, because a single-token comment can be a token-subset of more than one
 * detachment name in the same faction (Chaos Space Marines' "Raiders" is a subset of both
 * "Renegade Raiders" and "Murdertalon Raiders"). When more than one detachment matches by name,
 * the candidates are narrowed to those whose entry id the enhancements' visibility conditions
 * reference (the "Raiders" enhancements are gated on Renegade Raiders being selected); if that
 * still isn't exactly one, the group is logged and skipped rather than guessed — misattributing
 * enhancements to the wrong detachment is worse than omitting them. Likewise a group matching zero detachments is
 * logged and skipped (comment text that doesn't resolve, e.g. a BSData-internal shorthand).
 */
export function matchEnhancementGroups(groups: EnhancementGroup[], detachments: Detachment[]): void {
  const detachmentTokens = detachments.map(d => ({ det: d, tokens: wordTokens(d.name) }))
  for (const group of groups) {
    const groupTokens = wordTokens(group.comment)
    let candidates = detachmentTokens.filter(({ tokens }) => isSubsetOf(groupTokens, tokens))
    if (candidates.length > 1 && group.referencedIds) {
      const gated = candidates.filter(({ det }) => det.id && group.referencedIds!.has(det.id))
      if (gated.length === 1) candidates = gated
    }
    if (candidates.length === 1) {
      candidates[0].det.enhancements = group.enhancements
    } else if (candidates.length === 0) {
      console.warn(
        `  ⚠ ${group.enhancements.length} enhancement(s) with comment "${group.comment}" match no detachment — skipped`,
      )
    } else {
      console.warn(
        `  ⚠ ${group.enhancements.length} enhancement(s) with comment "${group.comment}" match ` +
          `${candidates.length} detachments ambiguously (${candidates.map(c => c.det.name).join(', ')}) — skipped`,
      )
    }
  }
}

/**
 * The catalogue ids a detachment entry is *restricted to*, read from its BSData visibility
 * modifiers. A chapter/sub-faction detachment hides itself via a `set hidden=true` modifier
 * gated on `notInstanceOf` / `scope="primary-catalogue"` conditions whose `childId` is the
 * catalogue it belongs to (e.g. "Unforgiven Task Force" → Dark Angels' catalogue id). An empty
 * result means the detachment is ungated — generic and legal for every importer of the group.
 */
export function gatingChildIds(entry: SelectionEntry): string[] {
  const ids: string[] = []
  for (const mod of entry.modifiers?.modifier ?? []) {
    if (mod.field !== 'hidden' || mod.value !== 'true') continue
    const conditions = [
      ...(mod.conditions?.condition ?? []),
      ...(mod.conditionGroups?.conditionGroup ?? []).flatMap(g => g.conditions?.condition ?? []),
    ]
    for (const c of conditions) {
      if (c.type === 'notInstanceOf' && c.scope === 'primary-catalogue' && c.childId) {
        ids.push(c.childId)
      }
    }
  }
  return ids
}

/**
 * The catalogue ids a detachment entry is explicitly *hidden from* — the inverse of
 * {@link gatingChildIds}. The shared Aeldari Library marks its Asuryani detachments (Warhost,
 * Aspect Host, …) `hidden` when the primary catalogue is an `instanceOf` Drukhari, so a Drukhari
 * army never offers them. Only unconditional and OR-grouped conditions count: inside an AND group
 * `instanceOf` alone doesn't hide the entry.
 */
export function excludedCatalogueIds(entry: SelectionEntry): string[] {
  const ids: string[] = []
  for (const mod of entry.modifiers?.modifier ?? []) {
    if (mod.field !== 'hidden' || mod.value !== 'true') continue
    const conditions = [
      ...(mod.conditions?.condition ?? []),
      ...(mod.conditionGroups?.conditionGroup ?? [])
        .filter(g => g.type === 'or')
        .flatMap(g => g.conditions?.condition ?? []),
    ]
    for (const c of conditions) {
      if (c.type === 'instanceOf' && c.scope === 'primary-catalogue' && c.childId) ids.push(c.childId)
    }
  }
  return ids
}

/**
 * Select the catalogues whose detachment groups belong to a faction, scoping out the ally
 * catalogues its chain imports for roster-building (Agents of the Imperium, Imperial Knights,
 * allied AM/Tyranids/Daemons libraries, …). Without this, walking the whole import chain leaks
 * other factions' detachments — and the 12 Space Marine chapters each store the full 53-detachment
 * union. A catalogue is "owned" by the faction (primary catalogue `primary`) if:
 *
 *   1. It IS the primary.
 *   2. The primary's own top-level "…detachment…" `entryLink`(s) resolve into it. This catches
 *      "library" factions whose primary holds no detachment group but links one in a sibling
 *      library (Astra Militarum → AM Library, Chaos Daemons → Daemons Library, the Knights → their
 *      Library, Aeldari → Aeldari Library).
 *   3. It is an imported "chaptered codex" — its detachment group carries `primary-catalogue`
 *      gating (only `Imperium - Space Marines` and `Aeldari - Aeldari Library` do, each imported
 *      solely by its own family). This adopts the SM codex for ALL 12 chapters, including the
 *      divisio chapters that have no chapter-specific detachments of their own, while never pulling
 *      in ungated ally catalogues.
 *
 * `extractDetachments` then gate-filters the entries from these catalogues per chapter.
 */
export function selectOwnedCatalogues(
  allCatalogues: Catalogue[],
  primary: Catalogue,
  index: BsIndex,
): Catalogue[] {
  const owned = new Set<string>([primary.id])

  // (2) Resolve the primary's detachment entryLink target(s) to their owning catalogue.
  const idToCatalogueId = new Map<string, string>()
  for (const cat of allCatalogues) {
    for (const id of buildIndex([cat]).keys()) idToCatalogueId.set(id, cat.id)
  }
  for (const link of primary.entryLinks?.entryLink ?? []) {
    if (!link.name?.toLowerCase().includes('detachment')) continue
    const ownerCatId = idToCatalogueId.get(link.targetId)
    if (ownerCatId) owned.add(ownerCatId)
  }

  // (3) Adopt any imported chaptered codex (its group carries primary-catalogue gating).
  for (const cat of allCatalogues) {
    if (owned.has(cat.id)) continue
    if (detachmentEntriesOf(cat, index).some(e => gatingChildIds(e).length > 0)) owned.add(cat.id)
  }

  return allCatalogues.filter(cat => owned.has(cat.id))
}

/**
 * Extract structured detachments (with rules and any available stratagems) from a faction's
 * *owned* catalogues (see {@link selectOwnedCatalogues}), keeping only those legal for the
 * faction's primary catalogue `primaryCatalogueId`: a detachment is kept when it is ungated, or
 * gated to the primary itself (see {@link gatingChildIds}).
 *
 * Note: BSData 10e does not encode faction stratagems as machine-readable profiles. The
 * `stratagems` array of each Detachment is empty here; they are merged in later from Wahapedia.
 */
export function extractDetachments(
  ownedCatalogues: Catalogue[],
  index: BsIndex,
  primaryCatalogueId: string,
): Detachment[] {
  const detachments: Detachment[] = []
  const seenDetachmentIds = new Set<string>()

  for (const entry of legalDetachmentEntries(ownedCatalogues, index, primaryCatalogueId)) {
    if (seenDetachmentIds.has(entry.id)) continue
    seenDetachmentIds.add(entry.id)
    const det = entryToDetachment(entry, index)
    if (det) detachments.push(det)
  }

  matchEnhancementGroups(extractEnhancements(ownedCatalogues), detachments)

  return detachments
}

/**
 * The detachment entries of a faction's owned catalogues that are legal for its primary
 * catalogue: ungated, or gated to the primary itself (see {@link gatingChildIds}), and not
 * explicitly hidden from it (see {@link excludedCatalogueIds}, e.g. Asuryani ones for Drukhari).
 * Includes entries with no extractable content, which `extractDetachments` then drops.
 */
export function legalDetachmentEntries(
  ownedCatalogues: Catalogue[],
  index: BsIndex,
  primaryCatalogueId: string,
): SelectionEntry[] {
  return ownedCatalogues.flatMap(cat => detachmentEntriesOf(cat, index)).filter(entry => {
    const gate = gatingChildIds(entry)
    if (gate.length > 0 && !gate.includes(primaryCatalogueId)) return false
    return !excludedCatalogueIds(entry).includes(primaryCatalogueId)
  })
}

/**
 * Every detachment entry id in the given catalogues, whichever faction owns it. Used by the
 * ability visibility evaluator (lib/ingest/visibility.ts) to recognise a `hidden` condition on
 * another faction's detachment (e.g. Shadow Legion on the Crucible daemons Death Guard imports)
 * as one that can never hold.
 */
export function allDetachmentEntryIds(catalogues: Catalogue[], index: BsIndex): Set<string> {
  return new Set(catalogues.flatMap(cat => detachmentEntriesOf(cat, index)).map(e => e.id))
}
