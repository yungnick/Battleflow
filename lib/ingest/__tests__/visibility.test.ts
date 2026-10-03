import { describe, it, expect } from 'vitest'
import { evaluateVisibility, unionGates, type VisibilityContext } from '../visibility'

// Node shapes are the reshaped (bsdata11 → XML-style) form the ingest pipeline walks:
// `modifiers.modifier[]`, `conditions.condition[]`, string booleans/values.

const SHADOW_LEGION = 'det-shadow-legion'
const LEGION_OF_EXCESS = 'det-legion-of-excess'
const OTHER_FACTION_DET = 'det-other-faction'
const BOARDING_ACTIONS = 'force-boarding-actions'
const DAEMONS = 'cat-daemons'

const ctx: VisibilityContext = {
  primaryCatalogueId: DAEMONS,
  factionDetachmentIds: [SHADOW_LEGION, LEGION_OF_EXCESS],
  allDetachmentIds: new Set([SHADOW_LEGION, LEGION_OF_EXCESS, OTHER_FACTION_DET]),
  forceEntryIds: new Set([BOARDING_ACTIONS]),
}

const cond = (type: string, scope: string, childId: string, value = '1') => ({ type, scope, childId, value, field: 'selections' })
const hideWhen = (...conditions: object[]) => ({
  modifiers: { modifier: [{ type: 'set', field: 'hidden', value: 'true', conditions: { condition: conditions } }] },
})

describe('evaluateVisibility', () => {
  it('is always visible with no hidden rules', () => {
    expect(evaluateVisibility([{ name: 'Plain' }], ctx)).toEqual({ kind: 'always' })
  })

  it('gates a "hidden unless detachment selected" ability to that detachment (Gloam Rot)', () => {
    const gloamRot = { name: 'Gloam Rot', ...hideWhen(cond('lessThan', 'roster', SHADOW_LEGION)) }
    expect(evaluateVisibility([gloamRot], ctx)).toEqual({ kind: 'gated', gate: { detachments: [SHADOW_LEGION] } })
  })

  it('treats equalTo 0 on a detachment as "requires it" (Seductive Gambit)', () => {
    const node = hideWhen(cond('equalTo', 'force', LEGION_OF_EXCESS, '0'))
    expect(evaluateVisibility([node], ctx)).toEqual({ kind: 'gated', gate: { detachments: [LEGION_OF_EXCESS] } })
  })

  it('gates "hidden when detachment selected" as an exception', () => {
    const node = hideWhen(cond('atLeast', 'roster', SHADOW_LEGION))
    expect(evaluateVisibility([node], ctx)).toEqual({ kind: 'gated', gate: { exceptDetachments: [SHADOW_LEGION] } })
  })

  it("is never visible when it requires another faction's detachment", () => {
    const node = hideWhen(cond('lessThan', 'roster', OTHER_FACTION_DET))
    expect(evaluateVisibility([node], ctx)).toEqual({ kind: 'never' })
  })

  it('resolves primary-catalogue gates statically (Templar Vows)', () => {
    const templarVows = hideWhen(cond('notInstanceOf', 'primary-catalogue', 'cat-black-templars'))
    expect(evaluateVisibility([templarVows], ctx)).toEqual({ kind: 'never' })
    expect(evaluateVisibility([templarVows], { ...ctx, primaryCatalogueId: 'cat-black-templars' })).toEqual({ kind: 'always' })
  })

  it('assumes a standard (non-Boarding Actions) force', () => {
    expect(evaluateVisibility([hideWhen(cond('instanceOf', 'force', BOARDING_ACTIONS))], ctx)).toEqual({ kind: 'always' })
    expect(evaluateVisibility([hideWhen(cond('atLeast', 'roster', BOARDING_ACTIONS))], ctx)).toEqual({ kind: 'always' })
  })

  it('never hides on an undecidable (wargear) condition', () => {
    expect(evaluateVisibility([hideWhen(cond('lessThan', 'self', 'wargear-id'))], ctx)).toEqual({ kind: 'always' })
  })

  it('reveals a default-hidden node whose un-hide condition is undecidable', () => {
    const node = {
      hidden: 'true',
      modifiers: {
        modifier: [{ type: 'set', field: 'hidden', value: 'false', conditions: { condition: [cond('atLeast', 'parent', 'wargear-id')] } }],
      },
    }
    expect(evaluateVisibility([node], ctx)).toEqual({ kind: 'always' })
  })

  it('is never visible when hidden by default with no way to un-hide', () => {
    expect(evaluateVisibility([{ hidden: 'true' }], ctx)).toEqual({ kind: 'never' })
  })

  it('evaluates AND / OR condition groups', () => {
    // Warp Rifts shape: hidden when (no Shadow Legion AND not under a Shadow Legion ancestor).
    const and = {
      modifiers: {
        modifier: [{
          type: 'set', field: 'hidden', value: 'true',
          conditionGroups: { conditionGroup: [{ type: 'and', conditions: { condition: [
            cond('lessThan', 'force', SHADOW_LEGION),
            cond('notInstanceOf', 'ancestor', SHADOW_LEGION),
          ] } }] },
        }],
      },
    }
    expect(evaluateVisibility([and], ctx)).toEqual({ kind: 'gated', gate: { detachments: [SHADOW_LEGION] } })

    // Hidden when the primary is Daemons OR an undecidable wargear condition holds.
    const or = {
      modifiers: {
        modifier: [{
          type: 'set', field: 'hidden', value: 'true',
          conditionGroups: { conditionGroup: [{ type: 'or', conditions: { condition: [
            cond('instanceOf', 'primary-catalogue', DAEMONS),
            cond('notInstanceOf', 'root-entry', 'some-unit'),
          ] } }] },
        }],
      },
    }
    expect(evaluateVisibility([or], ctx)).toEqual({ kind: 'never' })
  })

  it('hides the ability when any node on the path is hidden', () => {
    const enclosing = hideWhen(cond('lessThan', 'roster', SHADOW_LEGION))
    const ability = hideWhen(cond('notInstanceOf', 'primary-catalogue', 'cat-black-templars'))
    expect(evaluateVisibility([enclosing, { name: 'ok' }], ctx).kind).toBe('gated')
    expect(evaluateVisibility([enclosing, ability], ctx)).toEqual({ kind: 'never' })
  })
})

describe('unionGates', () => {
  it('is ungated when either path is ungated', () => {
    expect(unionGates(undefined, { detachments: ['a'] })).toBeUndefined()
  })

  it('unions detachment lists', () => {
    expect(unionGates({ detachments: ['a'] }, { detachments: ['b'] })).toEqual({ detachments: ['a', 'b'] })
  })

  it('keeps only exceptions not covered by the other path', () => {
    expect(unionGates({ detachments: ['a'] }, { exceptDetachments: ['a', 'b'] })).toEqual({ exceptDetachments: ['b'] })
  })
})
