/**
 * Ability → phase classifier.
 *
 * Datasheet abilities carry no structured phase field — their `effect` and
 * `timing` strings are free 10th-edition prose. To decide which phase tab an
 * ability belongs on, we scan that prose for:
 *
 *  1. Literal phase words (`movement`, `shooting`, `charge`, `fight`,
 *     `command`, `battleshock` / `battle-shock`) — these catch phrases like
 *     "Shooting phase", "Fight phase", "Battle-shock test".
 *  2. A small set of verb aliases that 10e uses as proper nouns to refer to a
 *     phase implicitly (`Advances` → movement, `Shoots` → shooting, `Fights`
 *     → fight, `declares a Charge` → charge). These let abilities like
 *     "Each time this unit Advances, …" land on the movement tab even though
 *     the word "movement" never appears.
 *
 * Word-boundary matching keeps `\bcharge\b` from firing on "charged" or
 * "supercharger", and keeps `\bfight\b` from firing on "fights" (which has
 * its own pattern). Matching is case-insensitive throughout.
 *
 * An ability with **no** matches is treated as passive (e.g. "Invulnerable
 * Save", "Leader") and shown on **every** phase tab.
 */

import type { PhaseId } from '../types'
import { PHASE_IDS } from '../schemas'

/**
 * Per-phase regex patterns, each tested against `effect + timing`.
 * Order within a phase doesn't matter — any match adds the phase.
 *
 * Round-boundary phrasing maps to the structural turn that owns the boundary:
 *  - "(at the) start of the (battle) round" → command phase (first phase of
 *    every battle round).
 *  - "(at the) end of the (battle) round" → battleshock (last step of every
 *    battle round). This catches durations like "until the end of the battle
 *    round" too; that's intentional — those abilities are still resolved during
 *    the battleshock step, so surfacing them there is correct.
 */
const ROUND_DET = '(?:the |a |an |any |each |every |its |next |the next )?'
const ROUND_START_RE = new RegExp(`\\bstart of ${ROUND_DET}(?:battle )?round\\b`, 'i')
const ROUND_END_RE   = new RegExp(`\\bend of ${ROUND_DET}(?:battle )?round\\b`, 'i')
// "first battle round" is a pre-game scout move: surfaces on command only (it happens
// before the first turn begins, not during the Movement phase).
const FIRST_BATTLE_ROUND_RE = /\bfirst battle round\b/i

const PHASE_PATTERNS: Record<PhaseId, RegExp[]> = {
  command:     [/\bcommand\b/i, ROUND_START_RE, FIRST_BATTLE_ROUND_RE],
  // "ingress move" is 11e's term for arriving from reserves (Deep Strike, Infiltrators-style
  // abilities): it happens in the Movement phase though the text never says so.
  movement:    [/\bmovement\b/i, /\badvances\b/i, /\bingress moves?\b/i],
  shooting:    [/\bshooting\b/i, /\bshoots\b/i],
  charge:      [/\bcharge\b/i, /\bdeclares a charge\b/i],
  fight:       [/\bfight\b/i, /\bfights\b/i],
  battleshock: [/\bbattle-?shock\b/i, ROUND_END_RE],
}

/** Pre-built passive set — returned (as a fresh copy) when nothing matches. */
const ALL_PHASES: readonly PhaseId[] = PHASE_IDS

/**
 * Return the set of phases an ability applies to, derived from its prose.
 *
 * Empty result is normalized to the full phase set: an ability that names no
 * phase and no phase-verb is "passive" and should appear under every tab.
 */
export function abilityPhasesFor(
  ability: { effect: string; timing?: string },
): Set<PhaseId> {
  const matched = explicitAbilityPhases(ability)
  return matched.size === 0 ? new Set(ALL_PHASES) : matched
}

/**
 * Phases an ability's prose names outright. Unlike {@link abilityPhasesFor}, a passive
 * ability (no phase named) yields an empty set instead of "every phase" — used to tell
 * "this ability is actively used in phase X" from "this ability merely applies in X".
 */
export function explicitAbilityPhases(
  ability: { effect: string; timing?: string },
): Set<PhaseId> {
  const text = `${ability.effect} ${ability.timing ?? ''}`
  const matched = new Set<PhaseId>()
  for (const phase of PHASE_IDS) {
    if (PHASE_PATTERNS[phase].some(p => p.test(text))) matched.add(phase)
  }
  return matched
}
