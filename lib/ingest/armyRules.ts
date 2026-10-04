/**
 * Curated per-faction army-rule allowlist + the ingest flagging helper.
 *
 * BSData models every faction-wide rule as an ordinary glossary ability with no
 * structured "this is the army rule" flag. Prose detection ("If your Army Faction
 * is…") is close but imperfect: it misses Adeptus Custodes / Adeptus Mechanicus
 * (whose rules are worded differently) and over-catches imported allied rules (a
 * Sororitas roster's glossary carries "Assigned Agents"; a chaos roster carries
 * every chaos sub-faction's rule). A hand-curated per-faction name allowlist sidesteps
 * both problems and, crucially, disambiguates the shared Space Marine codex — all 12
 * chapters' glossaries contain both "Oath of Moment" and "Templar Vows", but only
 * Black Templars should surface the latter.
 *
 * Each value is the exact glossary entry name; matching is normalisation-insensitive
 * (`norm` folds curly punctuation + case), so straight apostrophes here still match
 * Wahapedia's curly ones. Factions intentionally absent from the map have no army rule
 * to surface: `adeptus-titanicus` / `titanicus-traitoris` (a separate game system),
 * `agents-of-the-imperium` ("Assigned Agents" is an allying rule, not an army-wide
 * combat rule), and `ynnari` (borrows Aeldari/Drukhari rules, none its own).
 *
 * Applied at BSData ingest (`normalize.ts`) and re-applied to committed artifacts by
 * the one-time patch CLI (`armyRulesCli.ts`).
 */

import { norm } from '../roster/normalize'
import type { FactionArtifact } from '../schemas'

/** Faction id → exact glossary names of that faction's army rule(s). */
export const ARMY_RULES: Record<string, string[]> = {
  'adepta-sororitas': ['Acts of Faith'],
  // Custodes / AdMech don't use the "If your Army Faction is…" phrasing — manual entries.
  'adeptus-custodes': ["Martial Ka'tah"],
  'adeptus-mechanicus': ['Doctrina Imperatives'],
  'astra-militarum': ['Voice of Command'],
  // Black Templars share the SM codex glossary (which also holds Oath of Moment) but
  // their own army rule is Templar Vows — list only that, never Oath of Moment.
  'black-templars': ['Templar Vows'],
  'blood-angels': ['Oath of Moment'],
  'chaos-daemons': ['The Shadow of Chaos'],
  'chaos-knights': ['Harbingers of Dread'],
  'chaos-space-marines': ['Dark Pacts'],
  'craftworlds': ['Battle Focus'],
  'dark-angels': ['Oath of Moment'],
  'death-guard': ["Nurgle's Gift (Aura)"],
  'deathwatch': ['Oath of Moment'],
  // Drukhari also carry the Aeldari-library "Battle Focus" (Asuryani-gated) — exclude it.
  'drukhari': ['Power from Pain'],
  'emperor-s-children': ['Thrill Seekers'],
  // Genestealer Cults glossary leaks Tyranid (Synapse / Shadow in the Warp) + Astra
  // (Voice of Command) rules from imported broods — keep only Cult Ambush.
  'genestealer-cults': ['Cult Ambush'],
  'grey-knights': ['Gate of Infinity'],
  'imperial-fists': ['Oath of Moment'],
  'imperial-knights': ['Code Chivalric'],
  'iron-hands': ['Oath of Moment'],
  'leagues-of-votann': ['Prioritised Efficiency'],
  'necrons': ['Reanimation Protocols'],
  // Wahapedia's Orks "Army Rules" section lists all three.
  'orks': ['Waaagh!', 'Da Boss', 'Unstable Energies'],
  'raven-guard': ['Oath of Moment'],
  'salamanders': ['Oath of Moment'],
  'space-marines': ['Oath of Moment'],
  'space-wolves': ['Oath of Moment'],
  't-au-empire': ['For The Greater Good'],
  'thousand-sons': ['Cabal of Sorcerers'],
  // Tyranids have two army-wide rules.
  'tyranids': ['Synapse', 'Shadow in the Warp'],
  'ultramarines': ['Oath of Moment'],
  'white-scars': ['Oath of Moment'],
  'world-eaters': ['Blessings of Khorne'],
}

/**
 * Tag glossary entries whose name is in `ARMY_RULES[factionId]` with `armyRule: true`.
 *
 * Mutates and returns the same artifact (other ingest passes follow this read→patch→
 * rewrite convention). Entries already flagged stay flagged; non-army rules are left
 * untouched. A faction absent from the map is a no-op.
 */
export function flagArmyRules(artifact: FactionArtifact): FactionArtifact {
  const names = ARMY_RULES[artifact.factionId]
  if (!names || names.length === 0) return artifact

  const allow = new Set(names.map(norm))
  for (const entry of artifact.glossary) {
    if (allow.has(norm(entry.name))) entry.armyRule = true
  }
  return artifact
}
