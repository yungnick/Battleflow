import { describe, it, expect } from 'vitest'
import { parseGwText } from '../parseGwText'

// ── BattleBase format (compact — no blank lines between units) ────────────────

describe('parseGwText – BattleBase format', () => {
  const BB_SAMPLE = `
If you can't beat 'em - eat 'em (2000 Points)
Chaos Daemons
Daemonic Incursion
Strike Force (2000 Points)
CHARACTERS
Be'lakor (375 Points)
    • Warlord
    • 1x Betraying Shades
    • 1x The Blade of Shadows
Bloodthirster (325 Points)
    • 1x Great axe of Khorne
    • 1x Hellfire breath
    • Enhancement: A'rgath, The King of Blades
BATTLELINE
Plaguebearers (110 Points)
    • 1x Plagueridden
        ◦ 1x Plaguesword
    • 9x Plaguebearer
        ◦ 9x Plaguesword
OTHER DATASHEETS
Beasts of Nurgle (65 Points)
    • 1x Putrid appendages
Exported with BattleBase, Data Version: v20260524
`.trim()

  it('extracts factionKeyword from the preamble', () => {
    expect(parseGwText(BB_SAMPLE).factionKeyword).toBe('Chaos Daemons')
  })

  it('extracts detachment from the preamble', () => {
    expect(parseGwText(BB_SAMPLE).detachment).toBe('Daemonic Incursion')
  })

  it('extracts totalPoints from the army-name line', () => {
    expect(parseGwText(BB_SAMPLE).totalPoints).toBe(2000)
  })

  it('parses all real units', () => {
    const names = parseGwText(BB_SAMPLE).units.map(u => u.name)
    expect(names).toContain("Be'lakor")
    expect(names).toContain('Bloodthirster')
    expect(names).toContain('Plaguebearers')
    expect(names).toContain('Beasts of Nurgle')
  })

  it('extracts wargear from count-prefixed indented bullets', () => {
    const bt = parseGwText(BB_SAMPLE).units.find(u => u.name === 'Bloodthirster')!
    expect(bt.wargear).toContain('Great axe of Khorne')
    expect(bt.wargear).toContain('Hellfire breath')
  })

  it('extracts enhancement from "Enhancement:" prefix', () => {
    const bt = parseGwText(BB_SAMPLE).units.find(u => u.name === 'Bloodthirster')!
    expect(bt.enhancements).toContain("A'rgath, The King of Blades")
    expect(bt.wargear).not.toContain("A'rgath, The King of Blades")
  })

  it('extracts sub-model wargear from doubly-indented ◦ bullets', () => {
    const pb = parseGwText(BB_SAMPLE).units.find(u => u.name === 'Plaguebearers')!
    expect(pb.wargear).toContain('Plaguesword')
  })

  it('does not treat "Exported with BattleBase" line as a unit', () => {
    const names = parseGwText(BB_SAMPLE).units.map(u => u.name)
    expect(names).not.toContain('Exported with BattleBase, Data Version: v20260524')
  })
})

// ── New Recruit app format (spaced — blank lines between units) ───────────────

describe('parseGwText – New Recruit app format', () => {
  const NR_APP_SAMPLE = `
If you can't beat 'em, eat 'em (2000 Points)

Chaos Daemons
Daemonic Incursion
Strike Force (2 000 Points)

CHARACTERS

Be'lakor (375 Points)
  • Warlord
  • 1x Betraying Shades
  • 1x The Blade of Shadows

Bloodthirster (325 Points)
  • 1x Great axe of Khorne
  • 1x Hellfire breath
  • Enhancements: A'rgath, The King of Blades

BATTLELINE

Plaguebearers (110 Points)
  • 1x Plagueridden
     ◦ 1x Plaguesword
  • 9x Plaguebearer
     ◦ 9x Plaguesword

OTHER DATASHEETS

Beasts of Nurgle (65 Points)
  • 1x Putrid appendages

Exported with App Version: v1.53.0 (1), Data Version: v780
`.trim()

  it('extracts factionKeyword from the preamble', () => {
    expect(parseGwText(NR_APP_SAMPLE).factionKeyword).toBe('Chaos Daemons')
  })

  it('extracts detachment from the preamble', () => {
    expect(parseGwText(NR_APP_SAMPLE).detachment).toBe('Daemonic Incursion')
  })

  it('extracts totalPoints from the army-name line', () => {
    expect(parseGwText(NR_APP_SAMPLE).totalPoints).toBe(2000)
  })

  it('parses all real units', () => {
    const names = parseGwText(NR_APP_SAMPLE).units.map(u => u.name)
    expect(names).toContain("Be'lakor")
    expect(names).toContain('Bloodthirster')
    expect(names).toContain('Plaguebearers')
    expect(names).toContain('Beasts of Nurgle')
  })

  it('extracts wargear from count-prefixed bullets', () => {
    const bt = parseGwText(NR_APP_SAMPLE).units.find(u => u.name === 'Bloodthirster')!
    expect(bt.wargear).toContain('Great axe of Khorne')
    expect(bt.wargear).toContain('Hellfire breath')
  })

  it('extracts enhancement from "Enhancements:" prefix', () => {
    const bt = parseGwText(NR_APP_SAMPLE).units.find(u => u.name === 'Bloodthirster')!
    expect(bt.enhancements).toContain("A'rgath, The King of Blades")
    expect(bt.wargear).not.toContain("A'rgath, The King of Blades")
  })

  it('extracts sub-model wargear from indented ◦ bullets', () => {
    const pb = parseGwText(NR_APP_SAMPLE).units.find(u => u.name === 'Plaguebearers')!
    expect(pb.wargear).toContain('Plaguesword')
  })
})

// ── GW My Army format ────────────────────────────────────────────────────────

describe('parseGwText – GW My Army format', () => {
  // In the actual GW My Army export, section headers (CHARACTER, BATTLELINE) are separated
  // from unit entries by blank lines, so they land in their own blocks and are skipped.
  const GW_SAMPLE = `
+++ My Army [CHAOS DAEMONS] (1000 pts) +++

== Daemonic Incursion ==

CHARACTER

Bloodthirster (300 pts)
• 1x Bloodflail
• 1x Great axe of Khorne

BATTLELINE

Bloodletters (110 pts)
• 10x Hellblade
`.trim()

  it('extracts factionKeyword from [BRACKET] in the header', () => {
    const result = parseGwText(GW_SAMPLE)
    expect(result.factionKeyword).toBe('CHAOS DAEMONS')
  })

  it('extracts detachment from == == line', () => {
    const result = parseGwText(GW_SAMPLE)
    expect(result.detachment).toBe('Daemonic Incursion')
  })

  it('extracts totalPoints from the header', () => {
    const result = parseGwText(GW_SAMPLE)
    expect(result.totalPoints).toBe(1000)
  })

  it('parses at least one unit', () => {
    const result = parseGwText(GW_SAMPLE)
    expect(result.units.length).toBeGreaterThanOrEqual(1)
    expect(result.units.map(u => u.name)).toContain('Bloodthirster')
  })
})

// ── New Recruit / BattleScribe format ────────────────────────────────────────

describe('parseGwText – New Recruit / BattleScribe format', () => {
  const NR_SAMPLE = `
+ FACTION KEYWORD: CHAOS DAEMONS +
+ DETACHMENT: Daemonic Incursion (Warp Rifts) +
+ TOTAL ARMY POINTS: 1000pts +

Bloodthirster (300 pts)
• 1x Bloodflail
• 1x Great axe of Khorne

Bloodletters (110 pts)
• 10x Hellblade
`.trim()

  it('extracts factionKeyword from + FACTION KEYWORD: line', () => {
    const result = parseGwText(NR_SAMPLE)
    expect(result.factionKeyword).toBe('CHAOS DAEMONS')
  })

  it('extracts detachment including parenthetical suffix', () => {
    const result = parseGwText(NR_SAMPLE)
    // Raw value is preserved as-is (stripping happens only during matching in buildRoster)
    expect(result.detachment).toBe('Daemonic Incursion (Warp Rifts)')
  })

  it('extracts totalPoints from + TOTAL ARMY POINTS: line', () => {
    const result = parseGwText(NR_SAMPLE)
    expect(result.totalPoints).toBe(1000)
  })

  it('parses at least one unit', () => {
    const result = parseGwText(NR_SAMPLE)
    expect(result.units.length).toBeGreaterThanOrEqual(1)
    expect(result.units.map(u => u.name)).toContain('Bloodthirster')
  })

  it('does not include control lines as units', () => {
    const result = parseGwText(NR_SAMPLE)
    const names = result.units.map(u => u.name)
    expect(names).not.toContain('FACTION KEYWORD: CHAOS DAEMONS')
    expect(names).not.toContain('DETACHMENT: Daemonic Incursion (Warp Rifts)')
    expect(names).not.toContain('TOTAL ARMY POINTS: 1000pts')
  })

  it('handles the trailing + being absent on control lines', () => {
    const withoutTrailingPlus = `
+ FACTION KEYWORD: CHAOS DAEMONS
+ DETACHMENT: Daemonic Incursion (Warp Rifts)
+ TOTAL ARMY POINTS: 500pts

Bloodthirster (300 pts)
`.trim()
    const result = parseGwText(withoutTrailingPlus)
    expect(result.factionKeyword).toBe('CHAOS DAEMONS')
    expect(result.detachment).toBe('Daemonic Incursion (Warp Rifts)')
    expect(result.totalPoints).toBe(500)
  })
})

describe('parseGwText – un-bulleted continuation weapon lines', () => {
  const list = `
2k Nick (2000 points)

Tyranids
Ambush Predators (3 Detachment Points)
Strike Force (2000 points)

OTHER DATASHEETS

Biovores (60 points)
  • 1x Chitin-barbed limbs
    1x Spore Mine launcher

Hyperadapted Raveners (165 points)
  • 1x Ravener Prime
    • 1x Prime claws and talons
  • 4x Raveners
    • 4x Ravener heavy claws and talons
      1x Venom bolt

Zoanthropes (190 points)
  • 1x Neurothrope
    • 1x Chitinous claws and teeth
      1x Warp Blast
  • 5x Zoanthrope
    • 5x Chitinous claws and teeth
      5x Warp Blast

Exported with App Version: v2.7.1 (146), Data Version: v963
`.trim()

  it('keeps the bare continuation weapon after a bulleted one', () => {
    const units = parseGwText(list).units
    expect(units.find(u => u.name === 'Biovores')!.wargear).toEqual([
      'Chitin-barbed limbs',
      'Spore Mine launcher',
    ])
  })

  it('keeps nested continuation weapons and does not pick up the footer', () => {
    const units = parseGwText(list).units
    expect(units.find(u => u.name === 'Hyperadapted Raveners')!.wargear).toContain('Venom bolt')
    expect(units.find(u => u.name === 'Zoanthropes')!.wargear).toContain('Warp Blast')
    expect(units.some(u => u.name.startsWith('Exported'))).toBe(false)
  })
})
