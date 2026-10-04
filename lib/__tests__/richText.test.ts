import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRichText, stripRichText, type Block, type InlineNode } from '../richText'

type Para = Extract<Block, { type: 'paragraph' }>
type List = Extract<Block, { type: 'list' }>

const para = (src: string): InlineNode[] => (parseRichText(src)[0] as Para).content

describe('parseRichText inline', () => {
  it('treats ^^x^^ as a keyword', () => {
    expect(para('a ^^Psyker^^ b')).toEqual([
      { type: 'text', text: 'a ' }, { type: 'keyword', text: 'Psyker' }, { type: 'text', text: ' b' },
    ])
  })

  it.each([
    ['^^**Adeptus Astartes**^^'],
    ['**^^Adeptus Astartes^^**'],
    ['^^**Adeptus Astartes^^**'],
    ['^^***Adeptus Astartes^^***'],
  ])('collapses redundant bold around keywords: %s', src => {
    expect(para(`x ${src} y`)).toEqual([
      { type: 'text', text: 'x ' }, { type: 'keyword', text: 'Adeptus Astartes' }, { type: 'text', text: ' y' },
    ])
  })

  it('does not open a stray italic after a malformed ^^**x^^*** closer', () => {
    const nodes = para('^^**Tzeentch Mutant Mounted^^*** unit from your army is selected')
    expect(nodes.map(n => n.type)).toEqual(['keyword', 'text'])
  })

  it('renders **x** as a term and bold ALL-CAPS as a keyword', () => {
    expect(para('inflict **mortal wounds** on a **DEDICATED TRANSPORT**')).toEqual([
      { type: 'text', text: 'inflict ' }, { type: 'term', text: 'mortal wounds' },
      { type: 'text', text: ' on a ' }, { type: 'keyword', text: 'DEDICATED TRANSPORT' },
    ])
  })

  it('recognises a line-leading **Label**: and the screenshot case', () => {
    const [a, b] = parseRichText(
      '^^***Thousand Sons^^*** units have the following ability:\n\n**Mortal Sorcery (Aura)**: While a friendly ^^**Psyker**^^ is within 6"',
    ) as Para[]
    expect(a.content[0]).toEqual({ type: 'keyword', text: 'Thousand Sons' })
    expect(b.content[0]).toEqual({ type: 'label', text: 'Mortal Sorcery (Aura)' })
  })

  it('maps <ins>Or:</ins>', () => {
    expect(para('<ins>Or:</ins> do this')[0]).toEqual({ type: 'or', text: 'Or:' })
  })

  it('never throws or leaves markers on unbalanced input', () => {
    expect(stripRichText('**oops ^^dangling ***x *y')).not.toMatch(/\^\^|\*/)
    expect(parseRichText('')).toEqual([])
  })
})

describe('parseRichText blocks', () => {
  it('turns ***Example:** into an example block', () => {
    const b = parseRichText('Rule text.\n***Example:** An Impulsor with Intercessors.*')
    expect(b.map(x => x.type)).toEqual(['paragraph', 'example'])
  })

  it('normalises bullet styles and nests nbsp-indented items', () => {
    const list = parseRichText('Intro:\n- one\n▪ two\n• three\n    - nested')
      .find(b => b.type === 'list') as List
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(3)
    expect(list.items[2].children).toHaveLength(1)
  })

  it('builds ordered lists', () => {
    const list = parseRichText('Do:\n1. first\n2. second')[1] as List
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(2)
  })
})

describe('corpus', () => {
  it('leaves no raw markers in any shipped effect text', () => {
    const root = join(__dirname, '../../public/data')
    const effects: string[] = []
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk)
      else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'effect' && typeof v === 'string') effects.push(v)
          else walk(v)
        }
      }
    }
    for (const dir of ['factions', 'shared']) {
      for (const f of readdirSync(join(root, dir))) walk(JSON.parse(readFileSync(join(root, dir, f), 'utf8')))
    }
    expect(effects.length).toBeGreaterThan(1000)
    const bad = effects.filter(e => /\^\^|\*|<\/?ins>/.test(stripRichText(e)))
    expect(bad.slice(0, 3)).toEqual([])
  })
})
