# Data audit fixes (2026-10-04)

**Status: implemented 2026-10-04** (uncommitted at time of writing). Beyond the plan, the work also
found and fixed: Agents of the Imperium's ownerless enhancements (gated-detachment attribution),
Tyranids / GSC enhancements living in the imported `Library - Tyranids`, the "Warhost" vs "Armoured
Warhost" tie, and two Wahapedia stratagem-label variants that dropped WHEN/EFFECT text (which was
the real cause of the 4 missing summaries). Orks army rules decision: Da Boss and Unstable Energies
are now flagged. The 3 hand-written summaries in `docs/summary-overrides.json` (no API key was
available) are `bb1a8fd68f7a`, `29561423f4c5`, `b8de28bf14be`.

Findings from the post-11e data audit. Sources (BSData `wh40k-11e` @ `8b91e6b`, Wahapedia Faction
Packs v1.2, Aug 2026) agree with our artifacts; the new Orks codex is not yet in either. The items
below are gaps in *our* ingest, not in the upstream data.

## 1. Enhancements missing for ~9 factions (bug, highest value)

**Symptom.** 0 enhancements for astra-militarum, orks, craftworlds, drukhari, genestealer-cults,
grey-knights, t-au-empire, tyranids, agents-of-the-imperium; space-marines (and chapters) only 6
across 15+ detachments. The app renders enhancements (`PhaseReferenceScreen.tsx`,
`UnitPhaseSection.tsx`), so users see none for these factions.

**Cause.** `extractEnhancements` (`lib/ingest/detachments.ts:354`) only reads entries that sit
*directly* in a top-level shared group named `Enhancements` / `<X> Enhancements`. Orks (and the
others) use a third BSData layout: a top-level `Enhancements` group whose *child groups* are
`<Detachment> Enhancements` (e.g. `War Horde Enhancements` → "Da Boss Is Watchin'"). The top-level
group has no direct `selectionEntries`, so nothing is emitted. There are also `Enhancements -
Upgrades` child groups (11e Upgrade enhancements, see `lib/schemas.ts:227`).

**Steps.**
1. Spike first: for every faction catalogue, dump the shape of its `Enhancements` groups (direct
   entries vs child groups vs `Enhancements - Upgrades` vs `entryLinks`) and write the findings
   into this doc. Confirms we recurse the right way before changing code.
2. Make `extractEnhancements` recurse into `selectionEntryGroups` of an enhancement group. Owner
   resolution order: entry `comment` → nearest enclosing `<X> Enhancements` group name → skip with
   the existing warning. Decide how `Enhancements - Upgrades` maps (owner = parent detachment
   group, `kind: 'upgrade'`) after step 1.
3. Keep `matchEnhancementGroups` semantics (global matching, ambiguity → skip + warn). Check the
   skip warnings after the run; zero silent drops.
4. Tests in `lib/ingest/__tests__/detachments.test.ts`: a nested-layout fixture (Orks-shaped), plus
   regression for the existing flat layouts (Necrons-style, SM-style, CSM "Raiders" tie-break).
5. Add committed-artifact assertions to `lib/data/__tests__/artifacts.test.ts`: Orks War Horde
   contains "Da Boss Is Watchin'"; no non-Titanicus faction with detachments has zero
   enhancements overall.

**Done when.** Every faction except the two Titanicus ones has enhancements on the detachments
Wahapedia lists them for; SM chapters carry enhancements for all codex detachments.

## 2. Re-run the ingest chain (needed to land #1)

Order matters (`AGENTS.md`): each step reads/rewrites the previous one's output.
1. `npm run ingest -- --ref <current HEAD sha>` (HEAD is 2 commits ahead of our pin; bumping now
   avoids a second data diff). `GITHUB_TOKEN` set.
2. `npm run ingest:wahapedia`
3. `npm run ingest:dedup`
4. `npm run ingest:summarise` (needs `ANTHROPIC_API_KEY`; cached in `docs/summary-overrides.json`)
5. `git diff --stat public/data/` and skim: expect enhancement additions only, plus whatever the
   2 upstream commits changed. Anything else (units/stratagems disappearing) is a regression, stop.
6. `npx tsc --noEmit && npm test`.

Land #1's code + tests and the data diff as two commits so the data diff stays reviewable.

## 3. Whitespace normalisation at ingest (small)

**Symptom.** Trailing spaces in names (`Horrifying Beauty `, `Helm of the Fly King `,
`Magna-rail cannon `), double spaces (`➤ Plasma caliver -  supercharge`, `➤ Voidraven Missiles -
Implosion Missiles` variants), and `InSv` values with trailing/lone newlines (`4+\n`, `\n`).

**Steps.**
1. In `lib/ingest/normalize.ts` (`toFactionArtifact`), trim and collapse internal runs of spaces for
   `name` fields (units, weapons, abilities, detachments, enhancements) and trim stat values
   (`M`, `T`, `Sv`, `InSv`, …). A lone-newline `InSv` becomes the empty/absent value the UI already
   handles; verify against how the nameplate renders `InSv` when empty.
2. Do NOT collapse whitespace inside `effect`/description prose; newlines are meaningful there.
3. Unit test with the exact offending strings. Must be applied before the dedup content hash is
   computed, so it rides along with the step-2 re-ingest (no separate data churn).
4. Check name-matching code that might key on the old strings (`lib/roster/`, `armyRules.ts` uses
   `norm`, so is safe) by running the roster tests.

## 4. Four stratagems without summaries

Masters of the Void (agents-of-the-imperium, Imperialis Fleet, appears twice), Storm of Darkness
(chaos-knights, Traitoris Lance), Expendable Biomass (tyranids, Tyranid Attack).

Covered by step 4 of #2 (`ingest:summarise`). After it runs, re-count; if any remain, inspect
the stratagem's `effect` text (likely a parse oddity such as empty effect or an unusual
format) rather than retrying blindly. Ensure the summaries end in a single period
(`withTerminalPeriod` already enforces).

## 5. Orks extra army rules (needs a decision)

Wahapedia's Orks "Army Rules" section lists **Waaagh!**, **Da Boss** and **Unstable Energies**
(plus a "Special Move Types" block). `ARMY_RULES['orks']` flags only Waaagh!; the other two sit
unflagged in the glossary.

**Decision needed from product owner:** surface Da Boss / Unstable Energies in the Army Rules
panel? If yes: add them to `ARMY_RULES.orks` in `lib/ingest/armyRules.ts`, run
`npm run ingest:armyrules -- --factions orks`, and extend `armyRules.test.ts`. Spot-check the
other factions' Wahapedia "Army Rules" headings against `ARMY_RULES` at the same time (audit only
covered Space Marines and Orks).

## 6. When the Orks 11e codex lands upstream

Not actionable today (neither source has it). Watch `BSData/wh40k-11e` commits touching
`Orks.json` and the Wahapedia Orks "Books" table (Faction Pack version/date). When either moves,
run the #2 chain; Wahapedia usually updates first, so a stratagems-only refresh
(`ingest:wahapedia` → `dedup` → `summarise`) is a valid intermediate step.

## Suggested order

#1 spike → #1 fix + tests → #3 → #2 (single re-ingest incl. #4) → #5 after the decision.
Total: one code PR + one data commit.
