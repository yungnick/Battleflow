import { describe, it, expect } from 'vitest'
import { abilityPhasesFor } from '../abilityPhase'
import { PHASE_IDS } from '../../schemas'

describe('abilityPhasesFor – passive abilities', () => {
  it('treats an ability with no phase prose as passive (every phase)', () => {
    const phases = abilityPhasesFor({
      effect: 'Models in this unit have an invulnerable save of 4+',
    })
    expect(phases.size).toBe(PHASE_IDS.length)
    for (const p of PHASE_IDS) expect(phases.has(p)).toBe(true)
  })

  it('handles missing timing (no `timing` property) without crashing', () => {
    const phases = abilityPhasesFor({ effect: 'A passive bonus.' })
    expect(phases.size).toBe(PHASE_IDS.length)
  })
})

describe('abilityPhasesFor – literal phase words', () => {
  it('matches a single phase from the effect text', () => {
    const phases = abilityPhasesFor({
      effect: 'In your Shooting phase, this unit gets +1 to hit.',
    })
    expect([...phases]).toEqual(['shooting'])
  })

  it('matches multiple phases mentioned in one ability', () => {
    const phases = abilityPhasesFor({
      effect: 'At the start of the Fight phase, until your next Movement phase, …',
    })
    expect(phases.has('fight')).toBe(true)
    expect(phases.has('movement')).toBe(true)
    expect(phases.size).toBe(2)
  })

  it('matches both battleshock spellings', () => {
    expect(abilityPhasesFor({ effect: 'Take a Battle-shock test.' }).has('battleshock')).toBe(true)
    expect(abilityPhasesFor({ effect: 'During the battleshock step …' }).has('battleshock')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(abilityPhasesFor({ effect: 'in the FIGHT phase' }).has('fight')).toBe(true)
    expect(abilityPhasesFor({ effect: 'In the fight phase' }).has('fight')).toBe(true)
  })
})

describe('abilityPhasesFor – verb aliases', () => {
  it('Advances → movement', () => {
    const phases = abilityPhasesFor({
      effect: 'Each time this unit Advances, do not make an Advance roll for it.',
    })
    expect(phases.has('movement')).toBe(true)
  })

  it('Shoots → shooting', () => {
    const phases = abilityPhasesFor({
      effect: 'Each time this model Shoots a particular weapon, …',
    })
    expect(phases.has('shooting')).toBe(true)
  })

  it('Fights → fight', () => {
    const phases = abilityPhasesFor({
      effect: 'Each time this unit Fights, on a successful hit …',
    })
    expect(phases.has('fight')).toBe(true)
  })

  it('declares a Charge → charge', () => {
    const phases = abilityPhasesFor({
      effect: 'Each time this unit declares a Charge, you can re-roll the dice.',
    })
    expect(phases.has('charge')).toBe(true)
  })
})

describe('abilityPhasesFor – opponent-phase prose still attaches to the phase', () => {
  it("counts the opponent's Shooting phase as a shooting-phase ability", () => {
    const phases = abilityPhasesFor({
      effect: "In your opponent's Shooting phase, this model can use this ability …",
    })
    expect(phases.has('shooting')).toBe(true)
  })
})

describe('abilityPhasesFor – word boundaries', () => {
  it('does not match "charged" for charge', () => {
    const phases = abilityPhasesFor({
      effect: 'Once this unit is charged, it gains a bonus.',
    })
    // Should still be passive (no literal phase / verb match).
    expect(phases.size).toBe(PHASE_IDS.length)
  })

  it('does not match "fights" via the bare \\bfight\\b pattern alone', () => {
    // The dedicated "fights" alias is what catches this — verifies the alias works.
    const phases = abilityPhasesFor({ effect: 'This model fights first.' })
    expect(phases.has('fight')).toBe(true)
  })
})

describe('abilityPhasesFor – round-boundary phrasing', () => {
  it('"start of the battle round" → command phase', () => {
    const phases = abilityPhasesFor({
      effect: 'At the start of the battle round, select one Shadow Form ability.',
    })
    expect(phases.has('command')).toBe(true)
  })

  it('"end of the battle round" → battleshock', () => {
    const phases = abilityPhasesFor({
      effect: 'At the end of the battle round, all unspent tokens are lost.',
    })
    expect(phases.has('battleshock')).toBe(true)
  })

  it('"start of the next battle round" still maps to command', () => {
    const phases = abilityPhasesFor({
      effect: 'Until the start of the next battle round, this model has that ability.',
    })
    expect(phases.has('command')).toBe(true)
  })

  it('a trigger at start of round + duration to end of round buckets to both', () => {
    const phases = abilityPhasesFor({
      effect: 'At the start of the battle round, select X. Until the end of the battle round, this model has Y.',
    })
    expect(phases.has('command')).toBe(true)
    expect(phases.has('battleshock')).toBe(true)
  })
})

describe('abilityPhasesFor – first battle round (Scouts)', () => {
  it('"first battle round" → command only (pre-game, not a Movement phase action)', () => {
    const phases = abilityPhasesFor({
      effect:
        'At the start of the first battle round, before the first turn begins, it can make a Normal move of up to 6".',
    })
    expect(phases.has('command')).toBe(true)
    expect(phases.has('movement')).toBe(false)
    expect(phases.size).toBe(1)
  })
})

describe('abilityPhasesFor – timing field is also scanned', () => {
  it('matches a phase named only in the timing string', () => {
    const phases = abilityPhasesFor({
      effect: 'Re-roll one hit roll.',
      timing: 'Your Shooting phase.',
    })
    expect(phases.has('shooting')).toBe(true)
  })
})

describe('ingress move', () => {
  it('puts Deep Strike on Movement only', () => {
    const phases = abilityPhasesFor({ effect: 'Each time this unit makes an ingress move (20.04), it can be set up anywhere.' })
    expect([...phases]).toEqual(['movement'])
  })
})
