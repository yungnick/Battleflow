/**
 * Invulnerable-save folding.
 *
 * The 40k save stat is a two-part thing — a model's armour save (`Sv 7+`) and,
 * if it has one, an invulnerable save (`Inv 4+`). BSData models the invuln as
 * a regular ability whose effect is just the save value ("4+"). Rendering it
 * as an ability chip is noise: the player already reads the SV stat when
 * checking durability, so the invuln belongs next to it.
 *
 * This module folds the **plain** "Invulnerable Save" ability into the SV
 * stat (formatted as e.g. "7+, 4++") and removes it from the abilities list.
 * "Plain" means the literal ability name `Invulnerable Save` — variants the
 * data uses for richer cases stay as their own chip because they carry extra
 * context that doesn't belong in a stat cell:
 *
 *  - `Invulnerable Save*` / `Invulnerable Save (4+*)` — conditional (e.g.
 *    melee-only); the asterisk footnote IS the rule.
 *  - `Invulnerable Save (Avatar)` / `Invulnerable Save: Bloodmaster` —
 *    personalised variants on a multi-model datasheet; folding into one SV
 *    cell would lose the per-model attribution.
 *  - `Invulnerable Save (4+)` — same shape as plain, but the parenthesised
 *    value is the data's signal that the unit has multiple invuln entries to
 *    disambiguate; keep the chip so the player can tell them apart.
 *  - `Invulnerable Save - Shadow Field` — named relic with extra rules.
 */

import type { Rule, Stats } from '../types'

const SAVE_DIGIT_RE = /\b([2-6])\+/

function isPlainInvulnSave(rule: { name: string }): boolean {
  return rule.name.trim().toLowerCase() === 'invulnerable save'
}

/**
 * Find a plain "Invulnerable Save" ability and return its save digit
 * (e.g. "4" for a 4+ save). Null when no plain invuln-save ability exists
 * or its effect text doesn't parse to a 2+/3+/.../6+ value.
 *
 * Accepts any `{ name, effect }`-shaped list so it works on both the flat
 * `Rule[]` and the structured `UnitAbility[]` the roster now carries.
 */
export function findPlainInvulnSave(abilities: readonly Pick<Rule, 'name' | 'effect'>[]): string | null {
  const a = abilities.find(isPlainInvulnSave)
  if (!a) return null
  const m = SAVE_DIGIT_RE.exec(a.effect)
  return m ? m[1] : null
}

/**
 * Return a copy of `abilities` with any plain "Invulnerable Save" entry removed.
 * Generic over the element type so a `UnitAbility[]` keeps its richer shape
 * (category / group) rather than being widened back to `Rule[]`.
 */
export function stripPlainInvulnSave<T extends Pick<Rule, 'name'>>(abilities: T[]): T[] {
  return abilities.filter(a => !isPlainInvulnSave(a))
}

export interface SaveCell {
  label: 'Sv'
  value: string
}

/** Leading save digit of a stat value ("4+", "5+*"), or null when empty / non-numeric. */
function saveDigit(v: string | undefined): number | null {
  const m = v ? /^\s*(\d)\+/.exec(v) : null
  return m ? Number(m[1]) : null
}

/** "4+*" → "4++*": invuln notation, keeping any trailing footnote marker. */
function invulnLabel(v: string): string {
  return v.replace(/^\s*(\d)\+/, '$1++').trim()
}

/** Both saves, always (expanded profile). `InSv` is omitted when the unit has none. */
export function fullSaves(stats: Stats | undefined): SaveCell[] {
  const cells: SaveCell[] = []
  if (stats?.Sv) cells.push({ label: 'Sv', value: stats.Sv })
  if (stats?.InSv && stats.InSv.trim()) cells.push({ label: 'Sv', value: invulnLabel(stats.InSv) })
  return cells
}

/**
 * Nameplate saves: show only the invuln when it is as good as or better than
 * the armour save (lower number), otherwise both. Unparseable values fall back
 * to showing both.
 */
export function nameplateSaves(stats: Stats | undefined): SaveCell[] {
  const cells = fullSaves(stats)
  if (cells.length < 2) return cells
  const sv = saveDigit(stats?.Sv)
  const inv = saveDigit(stats?.InSv)
  return sv !== null && inv !== null && inv <= sv ? [cells[1]] : cells
}

/**
 * Return a copy of `stats` with SV augmented to spell out the invuln save —
 * e.g. SV "7+" with invuln digit "4" → "7+, 4++". Pass-through when there is
 * no invuln digit or the stat block has no SV.
 */
export function withInvulnSv(
  stats: Stats | undefined,
  invulnDigit: string | null,
): Stats | undefined {
  if (!stats || !invulnDigit) return stats
  const sv = stats.SV
  if (!sv) return stats
  return { ...stats, SV: `${sv}, ${invulnDigit}++` }
}
