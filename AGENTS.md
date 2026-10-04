<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Game data (BSData + Wahapedia ingestion)

Faction rules come from two community sources, both ingested offline (never on the request path)
into small, self-contained per-faction JSON artifacts committed under `public/data/`:
- **Datasheets + detachments/rules** — `BSData/wh40k-10e` (BattleScribe XML).
- **Stratagems** — `wahapedia.ru` faction pages (BSData does not model stratagems as
  machine-readable profiles).

## Architecture
- **BSData ingestion (offline)** — `lib/ingest/` + `lib/parsers/bsdata.ts`. Fetches the pinned
  release, resolves BSData UUID cross-references (`catalogueLink` / `infoLink` / `entryLink`)
  across the faction `.cat` + imported catalogues + the `.gst`, extracts detachments and their
  rules (`lib/ingest/detachments.ts`), and emits `FactionArtifact`s. Run-once, never on the
  request path.
  - **Detachment scoping.** A faction's import chain pulls in ally catalogues for roster-building
    (Agents of the Imperium, Imperial Knights, allied AM/Tyranids/Daemons libraries, …), and every
    Space Marine chapter imports the one shared SM codex that holds *all* chapters' detachments.
    `selectOwnedCatalogues` (in `detachments.ts`) therefore scopes extraction to a faction's own
    catalogue(s): the primary, the catalogue its top-level "Detachment" `entryLink` resolves into
    (for "library" factions like AM / Chaos Daemons / Aeldari), and any imported *chaptered codex*
    (a detachment group carrying `primary-catalogue` gating — the SM codex / Aeldari library).
    `extractDetachments` then gate-filters per chapter via `gatingChildIds`: a detachment is kept
    only if it is ungated, or gated to the faction's own catalogue id — and it is dropped if BSData
    explicitly hides it from that primary (`excludedCatalogueIds`: an `instanceOf` primary-catalogue
    condition, e.g. the Aeldari Library's Asuryani detachments for Drukhari, or Librarius Conclave /
    1st Company Task Force for Black Templars). Different factions must never blend detachments.
    Without this, factions leak each other's detachments and the 12 SM chapters each store the full
    53-detachment union.
- **Enhancement extraction (offline)** — `extractEnhancements` / `matchEnhancementGroups` in
  `lib/ingest/detachments.ts`. BSData uses three layouts, all handled: flat `<Detachment>
  Enhancements` groups, a bare `Enhancements` pool whose entries carry a `comment` naming the
  detachment (Necrons), and a *nested* layout — top-level `Enhancements` + `Enhancements -
  Upgrades` groups whose child groups are the per-detachment ones (Orks, Grey Knights, T'au, the
  AM / Tyranids / Aeldari libraries, most of the SM codex; the walk recurses and tags `kind:
  'upgrade'`). Entries with no owner at all (Agents of the Imperium) are attributed via the single
  detachment id their `hidden` modifier is gated on. A faction whose detachments still have none
  after its owned catalogues also scans its *imported* catalogues (`Library - Tyranids` holds both
  Tyranid and GSC enhancements), exact-name only. Matching ties: visibility-gate id, then
  whole-name equality ("Warhost" beats "Armoured Warhost"); anything still ambiguous is skipped
  with a warning. `lib/data/__tests__/artifacts.test.ts` fails if any faction ends up with none.
- **Ability visibility gating (offline)** — `lib/ingest/visibility.ts`. BSData hides many unit
  abilities behind `hidden` modifiers rather than omitting them: detachment abilities linked onto
  every eligible datasheet (Gloam Rot on Nurgle daemons → Shadow Legion; each Necron detachment
  rule on every Necron unit), army rules restricted to one primary catalogue (Templar Vows →
  Black Templars only, though all 12 chapters link it), and Boarding Actions / Crusade variants.
  The unit walk (`collectUnit` in `resolve.ts`) evaluates these on every node along an ability's
  path: primary-catalogue and force (Boarding Actions / Crusade) conditions resolve statically,
  as do conditions on another faction's detachment (never selected). Abilities that can never be
  visible are dropped. Ones that depend on this faction's detachment are evaluated once per
  detachment and stored as `UnitAbility.detachments` (only with) / `exceptDetachments` (not
  with); `buildRoster` applies them against the roster's matched detachment ids and hides
  `detachments`-gated abilities when no detachment matched. Wargear / unit-local conditions
  (`self`, `parent`, `ancestor`, `model-or-unit`, …) are not evaluated and always resolve toward
  visible.
- **Wahapedia stratagem ingestion (offline)** — `lib/ingest/wahapedia.ts` (scraper) +
  `wahapediaCli.ts` (CLI) + `wahapediaFactions.ts` (faction→slug map). Scrapes the static faction
  pages, groups stratagem cards by detachment, and merges them into each existing artifact's
  `detachments[].stratagems` (matching detachment names case/punctuation-insensitively; appending
  synthesized shell detachments for any not in the pinned BSData release). Synthesis is suppressed
  for pages shared by >1 faction (only `space-marines`, served to all 12 chapters), so one
  chapter's page cannot re-introduce another chapter's detachments and undo the scoping above. Kept
  separate from the BSData CLI so the two sources refresh independently and stratagems need no
  GitHub token. Stratagem card labels come in three markups (`<b>WHEN:</b>`, `<b>WHEN</b>:`, plain `WHEN:` after a
  `<br>`) — `splitSections` handles all; a card with an empty `timing`/`effect` means a new variant
  (guarded by the artifacts test). Universal stratagems (Command Re-roll, Fire Overwatch, …) are maintained by hand in
  `lib/data/coreStratagems.ts`, not scraped.
- **Shared-detachment de-duplication (offline)** — `lib/ingest/dedupCli.ts`. Runs last (after
  Wahapedia). Detachments that end up byte-identical across ≥2 factions — the generic Codex: Space
  Marines detachments carried by all 12 chapters — are factored into a content-hashed
  `public/data/shared/<id>.json` set, removed from the per-faction artifacts, and referenced via
  `FactionArtifact.sharedDetachments`. The runtime loader merges them back. Faction-specific and
  Aeldari-library detachments (which differ in stratagem coverage) stay inline.
- **Army-rule flagging (offline)** — `lib/ingest/armyRules.ts`. BSData models a faction's
  army rule (Oath of Moment, Reanimation Protocols, Synapse, …) as an ordinary glossary
  ability with no structured flag. `flagArmyRules` tags the relevant glossary entries with
  `armyRule: true` from a curated per-faction name allowlist (`ARMY_RULES`). Curated rather than
  prose-detected because "If your Army Faction is…" misses Custodes / AdMech and over-catches
  imported allied rules, and because the per-faction map disambiguates the shared SM codex (all 12
  chapters carry both *Oath of Moment* and *Templar Vows*; only Black Templars surfaces the
  latter). Runs inside `toFactionArtifact` (so every ingest is correct) and is also exposed as a
  re-runnable back-fill CLI (`armyRulesCli.ts` / `npm run ingest:armyrules`). `buildRoster`
  surfaces the flagged entries via `RosterMeta.armyRules`, rendered alongside the matched
  detachment's rules in `RulesReferenceSection` (a persistent, non-phase-filtered section).
- **Storage** — committed JSON in `public/data/factions/<id>.json`, shared sets in
  `public/data/shared/<id>.json`, indexed by `public/data/manifest.json`, served as static CDN
  assets. Artifacts are versioned by content hash; the client requests them with `?v=<sha256>` so
  `next.config.ts` can mark them `immutable`. (Upgrade path if repo size becomes a problem: move
  artifacts to Vercel Blob — change only `lib/data/loader.ts`.)
- **Runtime** — `lib/data/loader.ts` (the storage seam) + `lib/data/adapter.ts`. The client
  loads exactly one faction on demand (`components/faction/FactionBrowser.tsx`); `loadFaction`
  also fetches and merges any shared detachment set the faction references.
- **Types** — `lib/dataModel.ts` (`FactionArtifact`, `PreparedUnit`, `DataManifest`,
  `SharedDetachmentSet`), extending the UI types in `lib/types.ts`.

## Updating game data (the "living rules" bump)
1. `npm run ingest -- --ref <sha-or-branch>` (omit `--ref` to use the latest commit; `--factions
   <slug,slug|all>`, `--dry-run` also supported). Set `GITHUB_TOKEN` to avoid API rate limits.
   This (re)writes datasheets + detachments/rules and resets `detachments[].stratagems`.
2. `npm run ingest:wahapedia -- [--factions <slug,slug|all>] [--dry-run]` to re-merge stratagems
   into the artifacts written in step 1. Run after every BSData ingest, since step 1 overwrites
   the artifacts the stratagems were merged into.
3. `npm run ingest:dedup -- [--dry-run]` to factor cross-faction-identical detachments (the shared
   SM Codex set) into `public/data/shared/`. Run after Wahapedia — it reads the final artifacts
   (stratagems already merged) and rewrites the per-faction ones with `sharedDetachments` references.
4. `npm run ingest:summarise -- [--factions <slug,slug|all>] [--no-interactive]` to write
   mechanical `summary` fields onto every stratagem. Run after dedup — it reads the final artifacts
   and patches them in place. Previously-generated summaries are cached in
   `docs/summary-overrides.json` (keyed by `sha256(effect)[0:12]`) so re-runs are instant for unchanged
   effects. `ANTHROPIC_API_KEY` is only needed when new/changed effects have no cached summary: copy
   `.env.example` to `.env.local` (gitignored; the script loads it) and set it there. Without a key the
   step still applies every cached summary, lists the uncached effects, and exits non-zero. **Must be re-run after every Wahapedia ingest**, because step 2 clears any
   summary fields that were set by a previous summarise run.
5. `npm run ingest:armyrules -- [--factions <slug,slug|all>] [--dry-run]` to tag each
   faction's army rule(s) in the glossary (`glossary[].armyRule`) from the curated allowlist
   in `lib/ingest/armyRules.ts`. **Optional / orthogonal:** the same `flagArmyRules` logic
   already runs inside BSData ingest (step 1), so a fresh ingest is correct without this; the
   CLI exists only to back-fill *already-committed* artifacts without a full re-ingest. It is
   idempotent and touches nothing but `armyRule`, so unlike summaries it is **not** clobbered by
   Wahapedia (step 2) / dedup (step 3) and never needs re-running after them. Warns loudly if an
   allowlisted name fails to resolve (glossary rename / typo).
6. Review `git diff public/data/` — it's a readable, reviewable data diff.
7. Commit and deploy. The pinned tag + commit are recorded in `manifest.json`.

## Known limitations / deferred
- **Phase inference is NOT done yet.** BSData has no phase field; `PreparedUnit.phases` is the
  reserved slot. Until it's populated, `lib/data/adapter.ts` surfaces every unit under every phase
  (the screen works as a faction datasheet browser, not yet a real phase filter).
- **Stratagem phase filtering is a prose heuristic, not structured.** Stratagems carry no phase
  field; `Strat.timing` is free Wahapedia prose ("Your opponent's Shooting phase…"). The phase
  screen filters by keyword-matching that prose (`stratagemMatchesPhase` in
  `PhaseReferenceScreen.tsx`): a stratagem mentioning a phase word shows only under matching
  phases, one mentioning none shows under all. Good enough in practice, but it will mis-bucket any
  stratagem whose timing is worded unusually.
- **Stratagem coverage is incomplete.** 33/36 factions have stratagems merged;
  `adeptus-titanicus`, `titanicus-traitoris`, and `ynnari` have none (no standard Wahapedia 10e
  detachment page — Ynnari borrows Aeldari detachments). New detachments not in the pinned BSData
  release land as synthesized shells with empty `rules` — except on the shared `space-marines`
  page, where synthesis is suppressed, so a brand-new SM detachment absent from pinned BSData would
  not appear until a BSData bump (the trade-off that keeps chapters from leaking each other's
  detachments).
- **Detachment scoping mirrors BSData visibility, not a hand-curated legal list.** A few results
  follow BSData rather than intuition: `adeptus-titanicus` / `titanicus-traitoris` get 0
  detachments (a separate game system, no detachment group of their own).
- **Licensing:** `BSData/wh40k-10e` has no explicit license; Warhammer 40,000 is Games Workshop
  IP. Distributing this data in a public product is a legal question for the project owner.
