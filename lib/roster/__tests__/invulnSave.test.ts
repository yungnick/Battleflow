import { describe, it, expect } from 'vitest'
import { findPlainInvulnSave, stripPlainInvulnSave, withInvulnSv, nameplateSaves, fullSaves } from '../invulnSave'
import type { Rule } from '../../types'

const rule = (over: Partial<Rule>): Rule => ({
  name: '',
  timing: '',
  effect: '',
  source: 'test',
  ...over,
})

describe('findPlainInvulnSave', () => {
  it('returns the digit from a plain "Invulnerable Save" with effect "4+"', () => {
    const abilities = [rule({ name: 'Invulnerable Save', effect: '4+' })]
    expect(findPlainInvulnSave(abilities)).toBe('4')
  })

  it('is case-insensitive on the name', () => {
    const abilities = [rule({ name: 'invulnerable save', effect: '5+' })]
    expect(findPlainInvulnSave(abilities)).toBe('5')
  })

  it('ignores conditional asterisk variant "Invulnerable Save*"', () => {
    const abilities = [
      rule({ name: 'Invulnerable Save*', effect: '4+\n* Melee attacks only.' }),
    ]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })

  it('ignores parenthesised variant "Invulnerable Save (4+)"', () => {
    const abilities = [
      rule({ name: 'Invulnerable Save (4+)', effect: 'This model has a 4+ invulnerable save.' }),
    ]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })

  it('ignores personalised variant "Invulnerable Save (Avatar)"', () => {
    const abilities = [
      rule({ name: 'Invulnerable Save (Avatar)', effect: 'The Avatar has a 4+ invulnerable save.' }),
    ]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })

  it('ignores named relic "Invulnerable Save - Shadow Field"', () => {
    const abilities = [
      rule({ name: 'Invulnerable Save - Shadow Field', effect: 'An Archon has an Invulnerable Save of 2+. …' }),
    ]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })

  it('returns null when no invuln-save ability exists', () => {
    const abilities = [rule({ name: 'Deep Strike' }), rule({ name: 'Feel No Pain' })]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })

  it('returns null when the effect text has no save digit to parse', () => {
    const abilities = [rule({ name: 'Invulnerable Save', effect: 'see datasheet' })]
    expect(findPlainInvulnSave(abilities)).toBeNull()
  })
})

describe('stripPlainInvulnSave', () => {
  it('removes the plain "Invulnerable Save" entry and preserves order of the rest', () => {
    const abilities = [
      rule({ name: 'Deep Strike' }),
      rule({ name: 'Invulnerable Save', effect: '4+' }),
      rule({ name: 'Feel No Pain' }),
    ]
    const stripped = stripPlainInvulnSave(abilities)
    expect(stripped.map(a => a.name)).toEqual(['Deep Strike', 'Feel No Pain'])
  })

  it('leaves the list untouched when no plain invuln-save is present', () => {
    const abilities = [rule({ name: 'Invulnerable Save (4+)', effect: '4+' })]
    expect(stripPlainInvulnSave(abilities)).toEqual(abilities)
  })
})

describe('withInvulnSv', () => {
  it('appends "<digit>++" to the existing SV value', () => {
    const stats = { M: '6"', T: '4', SV: '7+', W: '2' }
    expect(withInvulnSv(stats, '4')).toEqual({ M: '6"', T: '4', SV: '7+, 4++', W: '2' })
  })

  it('returns the input unchanged when the invuln digit is null', () => {
    const stats = { SV: '3+' }
    expect(withInvulnSv(stats, null)).toBe(stats)
  })

  it('returns the input unchanged when stats has no SV key', () => {
    const stats = { LD: '7+', OC: '2' }
    expect(withInvulnSv(stats, '4')).toBe(stats)
  })

  it('returns undefined when stats itself is undefined', () => {
    expect(withInvulnSv(undefined, '4')).toBeUndefined()
  })

  it('does not mutate the original stats object', () => {
    const stats = { SV: '3+' }
    withInvulnSv(stats, '4')
    expect(stats).toEqual({ SV: '3+' })
  })
})

describe('nameplateSaves', () => {
  const v = (Sv: string, InSv = '') => nameplateSaves({ Sv, InSv }).map(c => `${c.label} ${c.value}`)
  it('shows only Sv without an invuln', () => expect(v('3+')).toEqual(['Sv 3+']))
  it('shows both when invuln is worse than save', () => expect(v('2+', '5+')).toEqual(['Sv 2+', 'Sv 5++']))
  it('shows only InSv when better', () => expect(v('7+', '4+')).toEqual(['Sv 4++']))
  it('shows only InSv when equal', () => expect(v('4+', '4+')).toEqual(['Sv 4++']))
  it('keeps footnote markers', () => expect(v('3+', '5+*')).toEqual(['Sv 3+', 'Sv 5++*']))
  it('fullSaves always shows both', () => {
    expect(fullSaves({ Sv: '7+', InSv: '4+' }).map(c => `${c.label} ${c.value}`)).toEqual(['Sv 7+', 'Sv 4++'])
  })
})
