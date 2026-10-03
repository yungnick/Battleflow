import { describe, it, expect } from 'vitest'
import { buildIndex, enumerateUnits } from '../resolve'
import type { Catalogue, SelectionEntry } from '../../parsers/bsdata'

const statProfile = (id: string, name: string) => ({
  id,
  name,
  typeId: 'unit-type',
  typeName: 'Unit',
  characteristics: { characteristic: [] },
})

const cats = (id: string, names: string[]) => ({
  categoryLink: names.map((name, i) => ({ id: `${id}-cat-${i}`, name, targetId: `target-${name}` })),
})

describe('enumerateUnits', () => {
  it('detects units whose Unit stat profile is only reached via a profile infoLink', () => {
    // 11e Codex: Orks shape — Meganobz' model entry infoLinks a shared "Meganob" Unit profile.
    const unit = {
      id: 'meganobz',
      name: 'Meganobz',
      type: 'unit',
      categoryLinks: cats('meganobz', ['Faction: Orks']),
      selectionEntries: {
        selectionEntry: [
          {
            id: 'meganob-model',
            name: '2-6 Meganobz',
            type: 'model',
            infoLinks: { infoLink: [{ id: 'il-1', name: 'Meganob', type: 'profile', targetId: 'meganob-stat' }] },
          },
        ],
      },
    } as unknown as SelectionEntry
    const cat = {
      id: 'orks',
      name: 'Orks',
      gameSystemId: 'gst',
      revision: '1',
      sharedProfiles: { profile: [statProfile('meganob-stat', 'Meganob')] },
      selectionEntries: { selectionEntry: [unit] },
    } as unknown as Catalogue

    const units = enumerateUnits([cat], buildIndex([cat]))
    expect(units.map((u) => u.name)).toEqual(['Meganobz'])
    expect(units[0].statProfile?.name).toBe('Meganob')
  })

  it("inherits Faction: categories from the root entryLink when the entry has none", () => {
    // Agents of the Imperium tags its Legends Kill Teams "Faction: Agents of the Imperium" only on
    // the entryLink; the shared entry itself carries no Faction: keyword.
    const shared = {
      id: 'dw-term',
      name: 'Deathwatch Terminator Squad [Legends]',
      type: 'unit',
      profiles: { profile: [statProfile('dw-term-stat', 'Deathwatch Terminator')] },
      categoryLinks: cats('dw-term', ['Infantry', 'Deathwatch']),
    }
    const native = {
      id: 'inq',
      name: 'Inquisitor',
      type: 'unit',
      profiles: { profile: [statProfile('inq-stat', 'Inquisitor')] },
      categoryLinks: cats('inq', ['Faction: Inquisition']),
    }
    const cat = {
      id: 'agents',
      name: 'Imperium - Agents of the Imperium',
      gameSystemId: 'gst',
      revision: '1',
      sharedSelectionEntries: { selectionEntry: [shared, native] },
      entryLinks: {
        entryLink: [
          {
            id: 'l1', name: shared.name, type: 'selectionEntry', targetId: 'dw-term',
            categoryLinks: cats('l1', ['Faction: Agents of the Imperium', 'Retinue']),
          },
          {
            id: 'l2', name: native.name, type: 'selectionEntry', targetId: 'inq',
            categoryLinks: cats('l2', ['Faction: Agents of the Imperium']),
          },
        ],
      },
    } as unknown as Catalogue

    const byName = Object.fromEntries(enumerateUnits([cat], buildIndex([cat])).map((u) => [u.name, u.keywords]))
    // Only Faction: categories are inherited, and only onto entries lacking their own.
    expect(byName[shared.name]).toEqual(['Infantry', 'Deathwatch', 'Faction: Agents of the Imperium'])
    expect(byName['Inquisitor']).toEqual(['Faction: Inquisition'])
  })

  it('honours BSData hidden modifiers when given a visibility context', () => {
    // Gloam Rot shape: a shared ability profile hidden unless Shadow Legion is in the roster,
    // plus an option subtree hidden for this primary catalogue, plus an ungated ability.
    const hideUnless = (childId: string, scope: string, type = 'lessThan') => ({
      modifier: [{ type: 'set', field: 'hidden', value: 'true', conditions: { condition: [{ type, scope, childId, value: '1' }] } }],
    })
    const ability = (id: string, name: string, extra: object = {}) => ({
      id, name, typeId: 'ab', typeName: 'Abilities',
      characteristics: { characteristic: [{ name: 'Description', '#text': `${name} text.` }] },
      ...extra,
    })
    const unit = {
      id: 'plaguebearers',
      name: 'Plaguebearers',
      type: 'unit',
      profiles: { profile: [statProfile('pb-stat', 'Plaguebearer'), ability('native', 'Infected Outbreak')] },
      infoLinks: { infoLink: [{ id: 'il-gloam', name: 'Gloam Rot', type: 'profile', targetId: 'gloam' }] },
      selectionEntries: {
        selectionEntry: [{
          id: 'bt-only-option',
          name: 'Other faction option',
          type: 'upgrade',
          modifiers: hideUnless('cat-other', 'primary-catalogue', 'notInstanceOf'),
          profiles: { profile: [ability('never', 'Never Shown')] },
        }],
      },
    } as unknown as SelectionEntry
    const cat = {
      id: 'cat-daemons',
      name: 'Daemons',
      gameSystemId: 'gst',
      revision: '1',
      sharedProfiles: { profile: [ability('gloam', 'Gloam Rot', { modifiers: hideUnless('det-shadow', 'roster') })] },
      selectionEntries: { selectionEntry: [unit] },
    } as unknown as Catalogue
    const ctx = {
      primaryCatalogueId: 'cat-daemons',
      factionDetachmentIds: ['det-shadow', 'det-plague'],
      allDetachmentIds: new Set(['det-shadow', 'det-plague']),
      forceEntryIds: new Set<string>(),
    }

    const [ungated] = enumerateUnits([cat], buildIndex([cat]))
    expect(ungated.abilities.map((a) => a.name)).toEqual(['Infected Outbreak', 'Gloam Rot', 'Never Shown'])

    const [u] = enumerateUnits([cat], buildIndex([cat]), new Set(), ctx)
    expect(u.abilities.map((a) => a.name)).toEqual(['Infected Outbreak', 'Gloam Rot'])
    expect(u.abilityGates?.get('gloam')).toEqual({ detachments: ['det-shadow'] })
    expect(u.abilityGates?.has('native')).toBe(false)
  })
})
