import { describe, it, expect } from 'vitest'
import { cleanArtifactWhitespace, cleanName } from '../normalize'

describe('cleanName', () => {
  it('trims and collapses internal whitespace runs', () => {
    expect(cleanName('Horrifying Beauty ')).toBe('Horrifying Beauty')
    expect(cleanName('➤ Plasma caliver -  supercharge')).toBe('➤ Plasma caliver - supercharge')
  })
})

describe('cleanArtifactWhitespace', () => {
  it('cleans names and stat values at any depth but leaves prose newlines intact', () => {
    const artifact = {
      glossary: [{ name: 'Magna-rail cannon ', effect: 'Line one.\n\nLine two. ' }],
      units: [{
        name: 'Unit ',
        stats: { M: '6"', InSv: '4+\n', Sv: '\n' },
        weapons: [{ name: 'Gun  x', stats: { A: '2 ' } }],
      }],
    }
    cleanArtifactWhitespace(artifact)
    expect(artifact.glossary[0]).toEqual({ name: 'Magna-rail cannon', effect: 'Line one.\n\nLine two. ' })
    expect(artifact.units[0].name).toBe('Unit')
    expect(artifact.units[0].stats).toEqual({ M: '6"', InSv: '4+', Sv: '' })
    expect(artifact.units[0].weapons[0]).toEqual({ name: 'Gun x', stats: { A: '2' } })
  })
})
