/**
 * Zod runtime schemas for all shared data shapes in Battleflow.
 *
 * **Single source of truth**: every Zod schema lives here; TypeScript types are
 * derived from schemas via `z.infer<>` rather than being maintained separately.
 * Keeping the schemas in one file (rather than inside `lib/ingest/`) lets the
 * runtime loader (`lib/data/loader.ts`) import validation logic without pulling
 * in any BSData / ingest dependencies.
 *
 * Import hierarchy (all arrows = "imports from"):
 *
 *   lib/schemas.ts  ←  lib/data/loader.ts      (runtime: validates fetched JSON)
 *   lib/schemas.ts  ←  lib/ingest/normalize.ts  (re-exports schemas for the pipeline)
 *   lib/schemas.ts  ←  lib/dataModel.ts         (re-exports derived types for consumers)
 *   lib/schemas.ts  ←  lib/types.ts             (re-exports leaf types for UI consumers)
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/**
 * Version stamp embedded in every artifact. Increment when the shape changes.
 *
 * v2: datasheet abilities became structured ({@link UnitAbilitySchema}) — each carries a
 * `category` (core / faction / datasheet) and optional themed-group label, and the
 * Damaged profile is split into `PreparedUnit.damaged`. Requires a full re-ingest.
 *
 * v3: 11e cutover — data now comes from `BSData/wh40k-11e` instead of `wh40k-10e` (see
 * AGENTS.md). Adds `DetachmentSchema.dpCost` (Detachment Points), `forceDisposition`, and
 * promotes `enhancements` to {@link EnhancementSchema} (adds `kind`). Drops 10e-specific
 * assumptions — the field names/shapes otherwise carry over unchanged.
 */
export const DATA_SCHEMA_VERSION = 3 as const

// ---------------------------------------------------------------------------
// Phase IDs
// ---------------------------------------------------------------------------

/** All six turn phases, in order. Confirmed unchanged from 10e to 11e. */
export const PHASE_IDS = [
  'command', 'movement', 'shooting', 'charge', 'fight', 'battleshock',
] as const

// ---------------------------------------------------------------------------
// Leaf schemas (no cross-references between schemas)
// ---------------------------------------------------------------------------

/**
 * A free-form stat record mapping characteristic names to display strings.
 * Example: `{ M: '6"', T: '4', SV: '3+', W: '2', LD: '6+', OC: '2' }`.
 */
export const StatsSchema = z.record(z.string(), z.string())

/** A weapon modifier such as a conditional bonus or penalty. */
export const ModifierSchema = z.object({
  label: z.string(),
  /** The condition under which the modifier applies, if any. */
  cond: z.string().optional(),
})

/** A ranged or melee weapon profile as shown on a datasheet. */
export const WeaponSchema = z.object({
  name: z.string(),
  kind: z.enum(['melee', 'ranged']),
  stats: StatsSchema,
  /** Keyword tags from the "Keywords" characteristic (e.g. "Rapid Fire 1"). */
  tags: z.array(z.string()),
  mods: z.array(ModifierSchema),
})

/**
 * A rule or ability entry — covers datasheet abilities, detachment rules,
 * stratagems, and glossary entries.
 */
export const RuleSchema = z.object({
  name: z.string(),
  /**
   * Free prose describing when the rule activates.
   * For stratagems this is Wahapedia timing text (e.g. "Your Shooting phase…").
   * For BSData abilities this is empty — they have no structured timing field.
   */
  timing: z.string(),
  /** Optional use condition (e.g. "ADEPTUS ASTARTES unit only"). */
  cond: z.string().optional(),
  effect: z.string(),
  /** Faction or detachment name the rule comes from; used in the glossary for de-dup. */
  source: z.string(),
})

/** A stratagem — a {@link RuleSchema} extended with CP cost and usage restrictions. */
export const StratSchema = RuleSchema.extend({
  /** Command point cost. */
  cp: z.number(),
  /**
   * Usage restriction: `'battle'` = once per battle, `'phase'` = once per phase/turn,
   * `false` (or absent) = unlimited.
   */
  once: z.union([z.enum(['battle', 'phase']), z.literal(false)]).optional(),
  /**
   * Short one-sentence mechanical summary generated at ingest for the collapsed card
   * view. Absent until `ingest:summarise` has been run.
   */
  summary: z.string().optional(),
})

/**
 * A datasheet ability — a {@link RuleSchema} classified at ingest into the printed-card
 * taxonomy and, where BSData models it, grouped under a themed sub-ability heading.
 *
 *  - `category`
 *     - `core`     — an edition-wide ability defined in the GST (Deep Strike, Leader, …).
 *     - `faction`  — the army rule (Oath of Moment, Synapse, …). Classified for fidelity
 *                    but excluded from per-unit rendering — it lives in the army-level
 *                    section (see `buildRoster`).
 *     - `datasheet`— everything else: the unit's own bespoke abilities.
 *  - `group` / `groupBlurb` — when an ability profile's BSData `profileType` is not the
 *    generic `Abilities`, the type names a themed sub-group (Be'lakor "Shadow Form",
 *    Magnus "Crimson King", the Silent King "Triarch Abilities"). `group` is that type
 *    name; `groupBlurb` is the same-named parent ability's text when one exists.
 */
export const UnitAbilitySchema = RuleSchema.extend({
  category: z.enum(['core', 'faction', 'datasheet']),
  /** Themed sub-group label (the BSData profileType) when not the generic `Abilities`. */
  group: z.string().optional(),
  /**
   * The group's introductory blurb, taken from a same-named parent ability if present.
   * Stored on the group's first child only (not repeated on every member); consumers
   * read it from there.
   */
  groupBlurb: z.string().optional(),
  /**
   * Detachment gate, read from BSData `hidden` modifiers at ingest (lib/ingest/visibility.ts).
   * When present, the ability applies only while one of these detachment ids is in the roster
   * (e.g. Gloam Rot on Nurgle daemons → Shadow Legion). Absent = no detachment condition.
   */
  detachments: z.array(z.string()).optional(),
  /** Inverse gate: the ability applies unless one of these detachment ids is in the roster. */
  exceptDetachments: z.array(z.string()).optional(),
})

// ---------------------------------------------------------------------------
// Compound schemas
// ---------------------------------------------------------------------------

/**
 * A named entry in a faction-wide reference table that an army rule points players at
 * (Thousand Sons' Cabal Rituals, World Eaters' Blessings of Khorne). BSData models these
 * tables as a standalone `selectionEntry`'s `<profile>` children, each with a themed
 * "requirement" characteristic (Warp Charge cost / dice roll) plus an `Effect` — no `Unit`
 * profile, so they never reach a unit, detachment, or glossary on their own.
 * `requirementLabel` carries the source characteristic's name ("Warp Charge" / "Roll") so
 * the UI can render either faction's vocabulary without hardcoding it.
 */
export const ArmyRuleOptionSchema = z.object({
  name: z.string(),
  requirement: z.string(),
  requirementLabel: z.string(),
  effect: z.string(),
})

/**
 * A shared ability/rule deduped into the faction-level glossary.
 * The `id` is a BSData UUID — the stable lookup key.
 */
export const GlossaryRuleSchema = RuleSchema.extend({
  id: z.string(),
  /**
   * `true` when this entry is one of the faction's army rule(s) (e.g. Oath of Moment,
   * Reanimation Protocols, Synapse). BSData has no structured flag for this, so it is
   * applied at ingest from a curated per-faction allowlist (`lib/ingest/armyRules.ts`).
   * The entry stays in `glossary` for existing unit cross-refs — this only tags it.
   */
  armyRule: z.boolean().optional(),
  /**
   * The named table an army rule references (Rituals / Blessings of Khorne), extracted
   * at ingest from a curated per-faction allowlist (`lib/ingest/armyRuleOptions.ts`).
   * Present only on the two army rules that point to such a table.
   */
  options: z.array(ArmyRuleOptionSchema).optional(),
})

/**
 * A unit prepared for the app. Superset of the UI `Unit` type.
 * `phases` is intentionally left unpopulated — phase inference is deferred;
 * this field is the reserved slot it will write into.
 */
export const PreparedUnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Derived from keywords: the highest-priority role keyword (Infantry, Character, …). */
  role: z.string(),
  /** Number of models in the base unit (currently always 1; squad expansion is deferred). */
  models: z.number(),
  /** All keyword strings from BSData categoryLinks (e.g. "Infantry", "Faction: Aeldari"). */
  tags: z.array(z.string()),
  hot: z.array(z.string()),
  weapons: z.array(WeaponSchema),
  /** Structured datasheet abilities — classified and grouped (see {@link UnitAbilitySchema}). */
  abilities: z.array(UnitAbilitySchema),
  stratagems: z.array(StratSchema),
  reminders: z.array(z.object({ text: z.string() })),
  /** BSData UUID — stable cross-reference key, also used as the unit's unique `id`. */
  bsId: z.string(),
  /** Unit statline (M, T, SV, W, LD, OC). Absent if the datasheet carries none. */
  stats: StatsSchema.optional(),
  /** Points cost for the base unit, if present in the BSData release. */
  points: z.number().optional(),
  /** `"Faction: X"` keyword strings belonging to this unit. */
  keywords: z.array(z.string()),
  /** BSData UUID references into the faction-level glossary. */
  ruleRefs: z.array(z.string()),
  /** Phases this unit is relevant in (deferred — see AGENTS.md). */
  phases: z.array(z.enum(PHASE_IDS)).optional(),
  /**
   * The unit's "Damaged: N-M wounds remaining" profile, carved out of the ability stream
   * at ingest. Promoted to its own row in the Phase 2 UI; until then `buildRoster` folds
   * it back into the flat ability list so it stays visible.
   */
  damaged: RuleSchema.optional(),
})

/**
 * An 11e detachment enhancement — a {@link RuleSchema} extended with the "Upgrade" vs
 * "Character" subtype distinction 11e introduced (Upgrade enhancements attach to a unit
 * rather than a Character model). Not structurally flagged by BSData; extracted from a
 * `<span class="EnhUpgrade">` marker on the matching Wahapedia card (see
 * `docs/11e-migration-plan.md` Phase 4/6). Absent `kind` means "character" (the common case).
 */
export const EnhancementSchema = RuleSchema.extend({
  kind: z.enum(['character', 'upgrade']).optional(),
})

/**
 * 11e's five Force Disposition values, from the GST's shared `Force Disposition`
 * selectionEntryGroup (confirmed structural in the Phase 1 spike — every detachment's
 * `categoryLinks` includes exactly one of these names).
 */
export const FORCE_DISPOSITIONS = [
  'Disruption', 'Priority Assets', 'Purge the Foe', 'Take and Hold', 'Reconnaissance',
] as const

/** One faction detachment with its rules and stratagems. */
export const DetachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Detachment-specific rules and abilities. Stored in the same shape as glossary
   * rules — `DetachmentRule` is an alias of `GlossaryRule`.
   */
  rules: z.array(GlossaryRuleSchema),
  stratagems: z.array(StratSchema),
  /**
   * Character enhancements available in this detachment. Extracted from BSData's
   * `sharedSelectionEntryGroups["Enhancements"]` (structural, confirmed in the Phase 1
   * spike — previously scraped from Wahapedia, which does not carry the "Upgrade" subtype
   * BSData doesn't flag either; see {@link EnhancementSchema}). Optional because older
   * artifacts pre-date this field and detachments synthesized from unscraped Wahapedia
   * pages have no enhancement data.
   */
  enhancements: z.array(EnhancementSchema).optional(),
  /** Detachment Points cost (11e). Read from BSData's structural `Detachment Points` cost. */
  dpCost: z.number().optional(),
  /** This detachment's Force Disposition (11e). Every detachment should have exactly one. */
  forceDisposition: z.enum(FORCE_DISPOSITIONS).optional(),
})

// ---------------------------------------------------------------------------
// Artifact schemas
// ---------------------------------------------------------------------------

/** One faction's fully-resolved, self-contained data artifact. */
export const FactionArtifactSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  factionId: z.string(),
  factionName: z.string(),
  bsCatalogueId: z.string(),
  /**
   * The `"Faction: X"` keywords that belong to this faction, derived at ingest to
   * filter out units from ally catalogues imported only for roster-building.
   */
  factionKeywords: z.array(z.string()),
  /** Inline detachments (faction-specific or Aeldari-library). */
  detachments: z.array(DetachmentSchema),
  /**
   * Ids of {@link SharedDetachmentSetSchema}s whose detachments belong here but are
   * stored once and shared across multiple factions (e.g. the generic Codex: Space
   * Marines detachments carried identically by all 12 chapters). The runtime loader
   * merges them into `detachments`. Absent when nothing is shared.
   */
  sharedDetachments: z.array(z.string()).optional(),
  units: z.array(PreparedUnitSchema),
  glossary: z.array(GlossaryRuleSchema),
})

/**
 * A set of detachments factored out of multiple faction artifacts because they are
 * byte-identical across them. Stored once and referenced by `FactionArtifact.sharedDetachments`.
 */
export const SharedDetachmentSetSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  id: z.string(),
  detachments: z.array(DetachmentSchema),
})

// ---------------------------------------------------------------------------
// Manifest schemas
// ---------------------------------------------------------------------------

/** A single faction's entry in the data manifest. */
export const ManifestFactionSchema = z.object({
  factionId: z.string(),
  factionName: z.string(),
  /** Faction keyword strings with the `"Faction: "` prefix stripped. */
  factionKeywords: z.array(z.string()),
  /** CDN-relative URL to the faction artifact JSON (e.g. `/data/factions/necrons.json`). */
  artifact: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  unitCount: z.number(),
})

/** A shared detachment set's manifest entry — its URL and content hash for immutable caching. */
export const ManifestSharedDetachmentsSchema = z.object({
  id: z.string(),
  artifact: z.string(),
  bytes: z.number(),
  sha256: z.string(),
})

/** The top-level manifest index (`public/data/manifest.json`). */
export const DataManifestSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  /**
   * The ref the ingest was run against. `wh40k-11e` ships no GitHub Releases (unlike
   * 10e's tagged releases), so this is almost always a branch name (`"main"`) rather than
   * a version tag today — `bsDataCommit` below is the actual reproducibility anchor.
   */
  bsDataTag: z.string(),
  bsDataCommit: z.string(),
  buildTime: z.string(),
  factions: z.array(ManifestFactionSchema),
  /** Shared detachment sets referenced by faction artifacts. */
  sharedDetachments: z.array(ManifestSharedDetachmentsSchema).optional(),
})

// ---------------------------------------------------------------------------
// Derived TypeScript types
// Each type below is the single source of truth — derived from its schema.
// ---------------------------------------------------------------------------

export type Stats = z.infer<typeof StatsSchema>
export type Modifier = z.infer<typeof ModifierSchema>
export type Weapon = z.infer<typeof WeaponSchema>
export type Rule = z.infer<typeof RuleSchema>
export type UnitAbility = z.infer<typeof UnitAbilitySchema>
export type Strat = z.infer<typeof StratSchema>
export type ArmyRuleOption = z.infer<typeof ArmyRuleOptionSchema>
export type GlossaryRule = z.infer<typeof GlossaryRuleSchema>
export type Enhancement = z.infer<typeof EnhancementSchema>

/**
 * Alias of {@link GlossaryRule}. Detachment-specific rules are stored in the same
 * shape as glossary rules; the dedicated name keeps `detachments.ts` readable.
 */
export type DetachmentRule = GlossaryRule

export type PreparedUnit = z.infer<typeof PreparedUnitSchema>
export type Detachment = z.infer<typeof DetachmentSchema>
export type FactionArtifact = z.infer<typeof FactionArtifactSchema>
export type SharedDetachmentSet = z.infer<typeof SharedDetachmentSetSchema>
export type ManifestFaction = z.infer<typeof ManifestFactionSchema>
export type ManifestSharedDetachments = z.infer<typeof ManifestSharedDetachmentsSchema>
export type DataManifest = z.infer<typeof DataManifestSchema>
