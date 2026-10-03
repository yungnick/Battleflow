import { describe, it, expect } from 'vitest'
import { buildRoster } from '../buildRoster'
import type { FactionArtifact } from '../../dataModel'
import type { ParsedArmy } from '../parseGwText'

/** Minimal artifact fixture — only the fields buildRoster touches. */
function makeArtifact(overrides: Partial<FactionArtifact> = {}): FactionArtifact {
  return {
    schemaVersion: 3,
    factionId: 'chaos-daemons',
    factionName: 'Chaos Daemons',
    bsCatalogueId: 'test-cat-id',
    factionKeywords: ['Chaos Daemons', 'Chaos'],
    detachments: [
      {
        id: 'det-incursion',
        name: 'Daemonic Incursion',
        rules: [],
        stratagems: [
          { name: 'Blood Tithe', timing: 'Any phase', cp: 1, effect: 'Do stuff.', source: 'Chaos Daemons' },
        ],
      },
    ],
    units: [
      {
        id: 'unit-bloodthirster',
        bsId: 'bs-bt',
        name: 'Bloodthirster',
        role: 'lord of war',
        models: 1,
        stats: { M: '12"', T: '9', SV: '2+', W: '18', LD: '6+', OC: '5' },
        hot: [],
        weapons: [
          { name: 'Great axe of Khorne', kind: 'melee', stats: { A: 'D6+3', WS: '2+', S: '14', AP: '-3', D: 'D6+3' }, tags: [], mods: [] },
        ],
        abilities: [],
        stratagems: [],
        reminders: [],
        tags: [],
        keywords: ['Chaos Daemons'],
        ruleRefs: [],
      },
    ],
    glossary: [],
    ...overrides,
  }
}

// ── Detachment matching ───────────────────────────────────────────────────────

describe('buildRoster – detachment matching', () => {
  const artifact = makeArtifact()

  it('resolves stratagems via exact detachment name match', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      totalPoints: 300,
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.stratagems).toBeDefined()
    expect(meta.stratagems!.map(s => s.name)).toContain('Blood Tithe')
  })

  it('resolves stratagems when detachment has a parenthetical suffix', () => {
    // New Recruit exports "Daemonic Incursion (Warp Rifts)" but artifact stores "Daemonic Incursion"
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion (Warp Rifts)',
      totalPoints: 300,
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.stratagems).toBeDefined()
    expect(meta.stratagems!.map(s => s.name)).toContain('Blood Tithe')
  })

  it('returns no stratagems when detachment does not match', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Unknown Detachment',
      totalPoints: 300,
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.stratagems).toBeUndefined()
  })
})

// ── Army & detachment rules in meta ───────────────────────────────────────────

describe('buildRoster – army & detachment rules', () => {
  // Artifact with a flagged army rule in the glossary and a detachment carrying rules.
  const artifact = makeArtifact({
    glossary: [
      { id: 'g-army', name: 'The Shadow of Chaos', timing: '', effect: 'Army-wide effect.', source: 'Chaos Daemons', armyRule: true },
      { id: 'g-other', name: 'Feel No Pain', timing: '', effect: 'Some keyword.', source: 'Chaos Daemons' },
    ],
    detachments: [
      {
        id: 'det-incursion',
        name: 'Daemonic Incursion',
        rules: [
          { id: 'd-rule', name: 'Daemonic Pact', timing: '', effect: 'Detachment effect.', source: 'Daemonic Incursion' },
        ],
        stratagems: [
          { name: 'Blood Tithe', timing: 'Any phase', cp: 1, effect: 'Do stuff.', source: 'Chaos Daemons' },
        ],
      },
    ],
  })

  it('surfaces only glossary entries flagged as army rules', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.armyRules.map(r => r.name)).toEqual(['The Shadow of Chaos'])
  })

  it('exposes the matched detachment rules and sets detachmentMatched', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.detachmentMatched).toBe(true)
    expect(meta.detachmentRules.map(r => r.name)).toEqual(['Daemonic Pact'])
  })

  it('keeps army rules but empties detachment rules when no detachment matches', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Unknown Detachment',
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: [] }],
    }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.detachmentMatched).toBe(false)
    expect(meta.detachmentRules).toEqual([])
    // Army rules are independent of detachment matching.
    expect(meta.armyRules.map(r => r.name)).toEqual(['The Shadow of Chaos'])
  })
})

// ── Multiple detachments (11e) ────────────────────────────────────────────────

describe('buildRoster – multiple detachments', () => {
  const det = (name: string, rule: string, strat: string, enh: string) => ({
    id: `det-${name}`,
    name,
    rules: [{ id: `r-${rule}`, name: rule, timing: '', effect: 'Effect.', source: name }],
    stratagems: [{ name: strat, timing: 'Any phase', cp: 1, effect: 'Do stuff.', source: name }],
    enhancements: [{ id: `e-${enh}`, name: enh, timing: '', effect: 'Enh.', source: name }],
  })
  const artifact = makeArtifact({
    detachments: [
      det('Changehost of Deceit', 'Deceit Rule', 'Deceit Strat', 'Deceit Enh'),
      det('Ritual of Regeneration', 'Regen Rule', 'Regen Strat', 'Tome of True Names'),
      det('Grand Coven', 'Coven Rule', 'Coven Strat', 'Coven Enh'),
    ],
  })

  it('resolves every detachment named on a joined line', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'Thousand Sons',
      detachment: 'Changehost of Deceit and Ritual of Regeneration',
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: ['Tome of True Names'] }],
    }
    const { roster, meta } = buildRoster(parsed, artifact)
    expect(meta.detachmentMatched).toBe(true)
    expect(meta.detachmentRules.map(r => r.name)).toEqual(['Deceit Rule', 'Regen Rule'])
    expect(meta.stratagems?.map(s => s.name)).toEqual(['Deceit Strat', 'Regen Strat'])
    // Enhancements resolve against every fielded detachment, not just the first.
    expect(roster.command?.[0].enhancements.map(e => e.name)).toEqual(['Tome of True Names'])
  })

  it.each([
    'Changehost of Deceit, Ritual of Regeneration',
    'Changehost of Deceit + Ritual of Regeneration',
    'Changehost of Deceit / Ritual of Regeneration',
    'Changehost of Deceit & Ritual of Regeneration',
    'Detachments: Changehost of Deceit | Ritual of Regeneration (3 DP)',
  ])('matches known names regardless of separator: %s', detachment => {
    const parsed: ParsedArmy = { factionKeyword: 'Thousand Sons', detachment, units: [] }
    const { meta } = buildRoster(parsed, artifact)
    expect(meta.detachmentRules.map(r => r.name)).toEqual(['Deceit Rule', 'Regen Rule'])
  })
})

// ── Unit building ─────────────────────────────────────────────────────────────

describe('buildRoster – unit matching', () => {
  const artifact = makeArtifact()

  it('matches a unit by normalized name', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Bloodthirster', wargear: ['Great axe of Khorne'], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    // Bloodthirster has a melee weapon so it appears in the fight phase
    expect(roster.fight?.map(u => u.name)).toContain('Bloodthirster')
  })

  it('matches a faction-prefixed unit when the export omits the prefix', () => {
    // BattleBase exports "Sorcerer"; BSData stores "Thousand Sons Sorcerer"
    const artifact = makeArtifact({
      units: [
        {
          id: 'unit-sorcerer',
          bsId: 'bs-sorc',
          name: 'Thousand Sons Sorcerer',
          role: 'character',
          models: 1,
          stats: { M: '6"', T: '4', SV: '3+', W: '4', LD: '6+', OC: '1' },
          hot: [],
          weapons: [
            { name: 'Force weapon', kind: 'melee', stats: { A: '3', WS: '3+', S: '6', AP: '-1', D: 'D3' }, tags: [], mods: [] },
          ],
          abilities: [],
          stratagems: [],
          reminders: [],
          tags: [],
          keywords: ['Thousand Sons'],
          ruleRefs: [],
        },
      ],
    })
    const parsed: ParsedArmy = {
      factionKeyword: 'Thousand Sons',
      detachment: 'Grand Coven',
      units: [{ name: 'Sorcerer', wargear: [], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    const allNames = Object.values(roster).flat().map(u => u.name)
    expect(allNames).toContain('Thousand Sons Sorcerer')
  })

  it('matches a unit when the export uses a different faction prefix', () => {
    // BattleBase exports "Chaos Rhino"; BSData stores "Thousand Sons Rhino"
    const artifact = makeArtifact({
      units: [
        {
          id: 'unit-rhino',
          bsId: 'bs-rhino',
          name: 'Thousand Sons Rhino',
          role: 'dedicated transport',
          models: 1,
          stats: { M: '12"', T: '9', SV: '3+', W: '10', LD: '6+', OC: '2' },
          hot: [],
          weapons: [
            { name: 'Combi-bolter', kind: 'ranged', stats: { A: '2', BS: '3+', S: '4', AP: '0', D: '1' }, tags: [], mods: [] },
          ],
          abilities: [],
          stratagems: [],
          reminders: [],
          tags: [],
          keywords: ['Thousand Sons'],
          ruleRefs: [],
        },
      ],
    })
    const parsed: ParsedArmy = {
      factionKeyword: 'Thousand Sons',
      detachment: 'Grand Coven',
      units: [{ name: 'Chaos Rhino', wargear: [], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    const allNames = Object.values(roster).flat().map(u => u.name)
    expect(allNames).toContain('Thousand Sons Rhino')
  })

  it('matches the faction-prefixed unit when a same-suffix unit also exists', () => {
    // "Sorcerer" should match "Thousand Sons Sorcerer", not "Exalted Sorcerer",
    // even though both end with " sorcerer".  The tie-break is prefix frequency:
    // "Thousand Sons" appears as a prefix for many units; "Exalted" appears for few.
    const artifact = makeArtifact({
      units: [
        {
          id: 'unit-sorc',
          bsId: 'bs-sorc',
          name: 'Thousand Sons Sorcerer',
          role: 'character',
          models: 1,
          stats: { M: '6"', T: '4', SV: '3+', W: '4', LD: '6+', OC: '1' },
          hot: [],
          weapons: [
            { name: 'Force weapon', kind: 'melee', stats: { A: '3', WS: '3+', S: '6', AP: '-1', D: 'D3' }, tags: [], mods: [] },
          ],
          abilities: [], stratagems: [], reminders: [], tags: [], keywords: [], ruleRefs: [],
        },
        {
          id: 'unit-exalted',
          bsId: 'bs-exalted',
          name: 'Exalted Sorcerer',
          role: 'character',
          models: 1,
          stats: { M: '6"', T: '4', SV: '3+', W: '5', LD: '6+', OC: '1' },
          hot: [],
          weapons: [
            { name: 'Force weapon', kind: 'melee', stats: { A: '4', WS: '3+', S: '6', AP: '-1', D: 'D3' }, tags: [], mods: [] },
          ],
          abilities: [], stratagems: [], reminders: [], tags: [], keywords: [], ruleRefs: [],
        },
        // Extra "Thousand Sons" prefixed units to make the prefix frequency unambiguous.
        {
          id: 'unit-rhino',
          bsId: 'bs-rhino',
          name: 'Thousand Sons Rhino',
          role: 'dedicated transport',
          models: 1,
          stats: { M: '12"', T: '9', SV: '3+', W: '10', LD: '6+', OC: '2' },
          hot: [],
          weapons: [
            { name: 'Combi-bolter', kind: 'ranged', stats: { A: '2', BS: '3+', S: '4', AP: '0', D: '1' }, tags: [], mods: [] },
          ],
          abilities: [], stratagems: [], reminders: [], tags: [], keywords: [], ruleRefs: [],
        },
      ],
    })
    const parsed: ParsedArmy = {
      factionKeyword: 'Thousand Sons',
      detachment: 'Grand Coven',
      units: [{ name: 'Sorcerer', wargear: [], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    const allNames = [...new Set(Object.values(roster).flat().map(u => u.name))]
    expect(allNames).toContain('Thousand Sons Sorcerer')
    expect(allNames).not.toContain('Exalted Sorcerer')
  })

  it('silently drops unrecognized unit names', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Nonexistent Unit', wargear: [], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    const allNames = Object.values(roster).flat().map(u => u.name)
    expect(allNames).not.toContain('Nonexistent Unit')
  })
})

// ── Enhancement resolution ────────────────────────────────────────────────────

describe('buildRoster – enhancement resolution', () => {
  function makeArtifactWithEnhancements(): FactionArtifact {
    return {
      schemaVersion: 3,
      factionId: 'chaos-daemons',
      factionName: 'Chaos Daemons',
      bsCatalogueId: 'test-cat-id',
      factionKeywords: ['Chaos Daemons'],
      detachments: [
        {
          id: 'det-incursion',
          name: 'Daemonic Incursion',
          rules: [],
          stratagems: [],
          enhancements: [
            { name: 'The Everstave', timing: '', effect: 'TZEENTCH only. +1 Strength.', source: 'Chaos Daemons' },
          ],
        },
      ],
      units: [
        {
          id: 'unit-lord',
          bsId: 'bs-loc',
          name: 'Lord of Change',
          role: 'character',
          models: 1,
          stats: { M: '12"', T: '11', SV: '4+', W: '18', LD: '6+', OC: '0' },
          hot: [],
          weapons: [
            { name: 'Daemonic Claws', kind: 'melee', stats: { A: '6', WS: '2+', S: '7', AP: '-2', D: '3' }, tags: [], mods: [] },
          ],
          abilities: [],
          stratagems: [],
          reminders: [],
          tags: [],
          keywords: ['Chaos Daemons'],
          ruleRefs: [],
        },
      ],
      glossary: [],
    }
  }

  it('resolves a known enhancement to a Rule on unit.enhancements', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Lord of Change', wargear: [], enhancements: ['The Everstave'] }],
    }
    const { roster } = buildRoster(parsed, makeArtifactWithEnhancements())
    const unit = roster.fight![0]
    expect(unit.enhancements).toHaveLength(1)
    expect(unit.enhancements[0].name).toBe('The Everstave')
    expect(unit.enhancements[0].effect).toContain('TZEENTCH')
    // Resolved enhancement should NOT also appear in hot[].
    expect(unit.hot).not.toContain('The Everstave')
  })

  it('falls back to a hot chip for an unknown enhancement name', () => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Lord of Change', wargear: [], enhancements: ['Unknown Relic'] }],
    }
    const { roster } = buildRoster(parsed, makeArtifactWithEnhancements())
    const unit = roster.fight![0]
    expect(unit.enhancements).toHaveLength(0)
    expect(unit.hot).toContain('Unknown Relic')
  })

  // Regression: Wahapedia stores names with the curly apostrophe `’` (e.g.
  // "A’rgath, the King of Blades"), but army-list exports normalize to the
  // ASCII `'`. Without curly-quote folding in `norm()`, the enhancement
  // wouldn't resolve to a Rule and would leak into `hot[]`.
  it('matches enhancements across curly vs straight apostrophes', () => {
    const artifact: FactionArtifact = {
      schemaVersion: 3,
      factionId: 'chaos-daemons',
      factionName: 'Chaos Daemons',
      bsCatalogueId: 'test-cat-id',
      factionKeywords: ['Chaos Daemons'],
      detachments: [
        {
          id: 'det-incursion',
          name: 'Daemonic Incursion',
          rules: [],
          stratagems: [],
          enhancements: [
            // Artifact carries Wahapedia's curly apostrophe.
            { name: 'A’rgath, the King of Blades', timing: '', effect: 'Bonus attacks.', source: 'Chaos Daemons' },
          ],
        },
      ],
      units: [
        {
          id: 'unit-bloodthirster',
          bsId: 'bs-bt',
          name: 'Bloodthirster',
          role: 'lord of war',
          models: 1,
          stats: { M: '12"', T: '9', SV: '2+', W: '18', LD: '6+', OC: '5' },
          hot: [],
          weapons: [
            { name: 'Great axe of Khorne', kind: 'melee', stats: { A: 'D6+3', WS: '2+', S: '14', AP: '-3', D: 'D6+3' }, tags: [], mods: [] },
          ],
          abilities: [],
          stratagems: [],
          reminders: [],
          tags: [],
          keywords: ['Chaos Daemons'],
          ruleRefs: [],
        },
      ],
      glossary: [],
    }

    // Army list uses the straight ASCII apostrophe.
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment: 'Daemonic Incursion',
      units: [{ name: 'Bloodthirster', wargear: [], enhancements: ["A'rgath, the King of Blades"] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    const unit = roster.fight![0]
    expect(unit.enhancements).toHaveLength(1)
    // The resolved Rule keeps the artifact's curly form (used for chip label).
    expect(unit.enhancements[0].name).toBe('A’rgath, the King of Blades')
    expect(unit.hot).not.toContain("A'rgath, the King of Blades")
    expect(unit.hot).not.toContain('A’rgath, the King of Blades')
  })
})

// ── Structured abilities (schema v2) ──────────────────────────────────────────

describe('buildRoster – structured abilities', () => {
  // A unit with one ability of each category plus a themed group whose three
  // members classify to DIFFERENT phases: one passive, one shooting-only, one
  // movement-only — exactly Magnus's "Crimson King" shape.
  function makeArtifactWithGroup(): FactionArtifact {
    return makeArtifact({
      units: [
        {
          id: 'unit-magnus',
          bsId: 'bs-magnus',
          name: 'Magnus the Red',
          role: 'character',
          models: 1,
          stats: { M: '12"', T: '11', SV: '4+', W: '18', LD: '6+', OC: '5' },
          hot: [],
          weapons: [
            { name: 'Blazing Staff', kind: 'ranged', stats: { R: '18"', A: '6', BS: '2+', S: '9', AP: '-3', D: '3' }, tags: [], mods: [] },
            { name: 'Crystal Staff', kind: 'melee', stats: { A: '6', WS: '2+', S: '9', AP: '-3', D: '3' }, tags: [], mods: [] },
          ],
          abilities: [
            { name: 'Deep Strike', timing: '', effect: 'Set up in Reserves.', source: 'Core', category: 'core' },
            { name: 'The Shadow of Chaos', timing: '', effect: 'Army-wide effect.', source: 'Thousand Sons', category: 'faction' },
            { name: 'Impossible Form', timing: '', effect: 'Subtract 1 from the Damage characteristic of attacks made against this model.', source: 'Thousand Sons', category: 'datasheet', group: 'Crimson King' },
            { name: 'Treason of Tzeentch', timing: '', effect: "At the start of your opponent's Shooting phase, select one enemy unit.", source: 'Thousand Sons', category: 'datasheet', group: 'Crimson King' },
            { name: 'Time Flux', timing: '', effect: 'Add 2" to the Move characteristic of nearby friendly units.', source: 'Thousand Sons', category: 'datasheet', group: 'Crimson King' },
          ],
          stratagems: [],
          reminders: [],
          tags: [],
          keywords: ['Chaos Daemons'],
          ruleRefs: [],
          damaged: { name: 'Damaged: 1-9 wounds remaining', timing: '', effect: 'Subtract 1 from this model’s hit rolls.', source: 'Thousand Sons' },
        },
      ],
    })
  }

  const parsed: ParsedArmy = {
    factionKeyword: 'CHAOS DAEMONS',
    detachment: undefined,
    units: [{ name: 'Magnus the Red', wargear: [], enhancements: [] }],
  }

  it('drops the army-level faction ability but keeps core + datasheet', () => {
    const { roster } = buildRoster(parsed, makeArtifactWithGroup())
    const unit = roster.charge!.find(u => u.name === 'Magnus the Red')!
    const names = unit.abilities.map(a => a.name)
    expect(names).not.toContain('The Shadow of Chaos')
    expect(names).toContain('Deep Strike')
    expect(unit.abilities.find(a => a.name === 'Deep Strike')!.category).toBe('core')
  })

  it('keeps a themed group whole in every phase a member is relevant', () => {
    const { roster } = buildRoster(parsed, makeArtifactWithGroup())
    // Movement: only Time Flux is natively a movement ability, yet the cohesion
    // rule must surface all three "Crimson King" members (regression: the group
    // used to fragment to 2 of 3).
    const move = roster.movement!.find(u => u.name === 'Magnus the Red')!
    const ck = move.abilities.filter(a => a.group === 'Crimson King').map(a => a.name)
    expect(ck).toHaveLength(3)
    expect(ck).toEqual(
      expect.arrayContaining(['Impossible Form', 'Treason of Tzeentch', 'Time Flux']),
    )
  })

  it('surfaces the separated Damaged profile on its own field, not in abilities', () => {
    const { roster } = buildRoster(parsed, makeArtifactWithGroup())
    const unit = roster.fight!.find(u => u.name === 'Magnus the Red')!
    expect(unit.damaged?.name).toContain('Damaged')
    expect(unit.full?.damaged?.name).toContain('Damaged')
    expect(unit.abilities.map(a => a.name)).not.toContain(unit.damaged!.name)
  })
})

// ── Structural detachment gates ───────────────────────────────────────────────

describe('buildRoster – detachment-gated abilities', () => {
  // Gloam Rot is a Shadow Legion ability BSData links onto every Nurgle daemon.
  const artifact = makeArtifact({
    detachments: [
      { id: 'det-shadow', name: 'Shadow Legion', rules: [], stratagems: [] },
      { id: 'det-plague', name: 'Plague Legion', rules: [], stratagems: [] },
    ],
    units: [
      {
        id: 'unit-pb',
        bsId: 'bs-pb',
        name: 'Plaguebearers',
        role: 'battleline',
        models: 10,
        hot: [],
        weapons: [],
        abilities: [
          { name: 'Infected Outbreak', timing: '', effect: 'Sticky objectives.', source: 'Chaos Daemons', category: 'datasheet' },
          { name: 'Gloam Rot', timing: '', effect: 'Subtract 1 from the Wound roll.', source: 'Chaos Daemons', category: 'datasheet', detachments: ['det-shadow'] },
          { name: 'Plague Ward', timing: '', effect: 'Not with Plague Legion.', source: 'Chaos Daemons', category: 'datasheet', exceptDetachments: ['det-plague'] },
        ],
        stratagems: [],
        reminders: [],
        tags: [],
        keywords: ['Chaos Daemons'],
        ruleRefs: [],
      },
    ],
  })
  const namesFor = (detachment: string | undefined) => {
    const parsed: ParsedArmy = {
      factionKeyword: 'CHAOS DAEMONS',
      detachment,
      units: [{ name: 'Plaguebearers', wargear: [], enhancements: [] }],
    }
    const { roster } = buildRoster(parsed, artifact)
    return roster.command!.find(u => u.name === 'Plaguebearers')!.abilities.map(a => a.name)
  }

  it('hides a gated ability when its detachment is not in the roster', () => {
    const names = namesFor('Plague Legion')
    expect(names).toContain('Infected Outbreak')
    expect(names).not.toContain('Gloam Rot')
    expect(names).not.toContain('Plague Ward')
  })

  it('shows a gated ability when its detachment is in the roster', () => {
    expect(namesFor('Shadow Legion')).toEqual(['Infected Outbreak', 'Gloam Rot', 'Plague Ward'])
  })

  it('hides detachment-only abilities when no detachment matched', () => {
    expect(namesFor(undefined)).toEqual(['Infected Outbreak', 'Plague Ward'])
  })
})
