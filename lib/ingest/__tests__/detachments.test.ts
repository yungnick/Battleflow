import { describe, it, expect, vi } from 'vitest'
import { excludedCatalogueIds, extractEnhancements, matchEnhancementGroups } from '../detachments'
import type { Catalogue, SelectionEntry } from '../../parsers/bsdata'
import type { Detachment } from '../../dataModel'

/** A bare-pool enhancement entry, hidden unless the detachment `gatedOn` is selected. */
const enh = (id: string, name: string, comment: string, gatedOn: string) => ({
  id,
  name,
  type: 'upgrade',
  comment,
  modifiers: {
    modifier: [{
      field: 'hidden', type: 'set', value: 'true',
      conditions: { condition: [{ type: 'lessThan', field: 'selections', scope: 'roster', childId: gatedOn, value: '1' }] },
    }],
  },
})

const det = (id: string, name: string) => ({ id, name, stratagems: [], rules: [] }) as unknown as Detachment

describe('matchEnhancementGroups', () => {
  it("breaks a name-subset tie using the detachment id the enhancement's visibility is gated on", () => {
    // Chaos Space Marines: comment "Raiders" is a token-subset of both detachment names.
    const cat = {
      id: 'csm', name: 'CSM', gameSystemId: 'gst', revision: '1',
      sharedSelectionEntryGroups: {
        selectionEntryGroup: [{
          id: 'pool', name: 'Enhancements',
          selectionEntries: {
            selectionEntry: [
              enh('e1', "Despot's Claim", 'Raiders', 'det-renegade'),
              enh('e2', 'Shadowcowl Talisman', 'Murdertalon', 'det-murder'),
            ],
          },
        }],
      },
    } as unknown as Catalogue
    const renegade = det('det-renegade', 'Renegade Raiders')
    const murder = det('det-murder', 'Murdertalon Raiders')

    matchEnhancementGroups(extractEnhancements([cat]), [renegade, murder])

    expect(renegade.enhancements?.map((e) => e.name)).toEqual(["Despot's Claim"])
    expect(murder.enhancements?.map((e) => e.name)).toEqual(['Shadowcowl Talisman'])
  })

  it('prefers the detachment whose whole name equals the comment over longer superset names', () => {
    const warhost = det('a', 'Warhost')
    const armoured = det('b', 'Armoured Warhost')
    matchEnhancementGroups(
      [{ comment: 'Warhost', enhancements: [{ name: 'X', timing: '', effect: '', source: 'Warhost' }] }],
      [armoured, warhost],
    )
    expect(warhost.enhancements?.map((e) => e.name)).toEqual(['X'])
    expect(armoured.enhancements).toBeUndefined()
  })

  it('still skips a name-ambiguous group with no structural tie-breaker', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = det('a', 'Renegade Raiders')
    const b = det('b', 'Murdertalon Raiders')
    matchEnhancementGroups([{ comment: 'Raiders', enhancements: [{ name: 'X', timing: '', effect: '', source: 'Raiders' }] }], [a, b])
    expect(a.enhancements).toBeUndefined()
    expect(b.enhancements).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ambiguously'))
    warn.mockRestore()
  })
})

describe('extractEnhancements — nested layout', () => {
  // Orks / Grey Knights / T'au shape: top-level "Enhancements" and "Enhancements - Upgrades"
  // groups whose child groups are the per-detachment "<Detachment> Enhancements" groups.
  const entry = (id: string, name: string) => ({ id, name, type: 'upgrade' })
  const cat = {
    id: 'orks', name: 'Orks', gameSystemId: 'gst', revision: '1',
    sharedSelectionEntryGroups: {
      selectionEntryGroup: [
        {
          id: 'pool', name: 'Enhancements',
          selectionEntryGroups: {
            selectionEntryGroup: [
              { id: 'g1', name: 'War Horde Enhancements', selectionEntries: { selectionEntry: [entry('e1', "Da Boss Is Watchin'")] } },
              { id: 'g2', name: 'Green Tide Enhancements', selectionEntries: { selectionEntry: [entry('e2', 'Mob Rule')] } },
            ],
          },
        },
        {
          id: 'up', name: 'Enhancements - Upgrades',
          selectionEntryGroups: {
            selectionEntryGroup: [
              { id: 'g3', name: 'Green Tide Enhancements', selectionEntries: { selectionEntry: [entry('e3', 'Bigger Mob')] } },
            ],
          },
        },
      ],
    },
  } as unknown as Catalogue

  it('walks child groups, owning entries by the enclosing "<Detachment> Enhancements" group', () => {
    const warHorde = det('d1', 'War Horde')
    const greenTide = det('d2', 'Green Tide')
    matchEnhancementGroups(extractEnhancements([cat]), [warHorde, greenTide])
    expect(warHorde.enhancements?.map((e) => e.name)).toEqual(["Da Boss Is Watchin'"])
    expect(greenTide.enhancements?.map((e) => e.name)).toEqual(['Mob Rule', 'Bigger Mob'])
  })

  it('tags entries from "Enhancements - Upgrades" with kind "upgrade" and leaves others untagged', () => {
    const greenTide = det('d2', 'Green Tide')
    matchEnhancementGroups(extractEnhancements([cat]), [greenTide])
    expect(greenTide.enhancements?.map((e) => e.kind)).toEqual([undefined, 'upgrade'])
  })

  it('still reads flat "<Detachment> Enhancements" groups with direct entries', () => {
    const flat = {
      id: 'sm', name: 'SM', gameSystemId: 'gst', revision: '1',
      sharedSelectionEntryGroups: {
        selectionEntryGroup: [
          { id: 'f', name: 'Gladius Task Force Enhancements', selectionEntries: { selectionEntry: [entry('e9', 'Artificer Armour')] } },
        ],
      },
    } as unknown as Catalogue
    const gladius = det('d9', 'Gladius Task Force')
    matchEnhancementGroups(extractEnhancements([flat]), [gladius])
    expect(gladius.enhancements?.map((e) => e.name)).toEqual(['Artificer Armour'])
  })
})

describe('enhancements without an owner comment (Agents of the Imperium)', () => {
  const pool = (entries: object[]) => ({
    id: 'agents', name: 'Agents', gameSystemId: 'gst', revision: '1',
    sharedSelectionEntryGroups: { selectionEntryGroup: [{ id: 'pool', name: 'Enhancements', selectionEntries: { selectionEntry: entries } }] },
  }) as unknown as Catalogue

  it('resolves the owner from the single detachment the entry is gated on', () => {
    const cat = pool([enh('e1', 'Beacon Angelis', undefined as unknown as string, 'det-fleet')])
    const fleet = det('det-fleet', 'Imperialis Fleet')
    const other = det('det-other', 'Veiled Blade')
    matchEnhancementGroups(extractEnhancements([cat]), [fleet, other])
    expect(fleet.enhancements?.map((e) => e.name)).toEqual(['Beacon Angelis'])
    expect(other.enhancements).toBeUndefined()
  })

  it('appends several same-detachment entries instead of overwriting', () => {
    const cat = pool([
      enh('e1', 'A', undefined as unknown as string, 'det-fleet'),
      enh('e2', 'B', undefined as unknown as string, 'det-fleet'),
    ])
    const fleet = det('det-fleet', 'Imperialis Fleet')
    matchEnhancementGroups(extractEnhancements([cat]), [fleet])
    expect(fleet.enhancements?.map((e) => e.name)).toEqual(['A', 'B'])
  })

  it('skips with a warning when no detachment matches the gate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cat = pool([enh('e1', 'Legends Thing', undefined as unknown as string, 'unknown-id')])
    const fleet = det('det-fleet', 'Imperialis Fleet')
    matchEnhancementGroups(extractEnhancements([cat]), [fleet])
    expect(fleet.enhancements).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no gating detachment'))
    warn.mockRestore()
  })
})

describe('matchEnhancementGroups — exact/quiet (imported library pass)', () => {
  const group = (comment: string) => ({ comment, enhancements: [{ name: 'X', timing: '', effect: '', source: comment }] })

  it('requires an exact name match and stays silent about unmatched groups', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const swarm = det('a', 'Invasion Fleet')
    const lookalike = det('b', 'Invasion Fleet Remnants')
    matchEnhancementGroups([group('Invasion Fleet'), group('Xenocult Masses')], [swarm, lookalike], { exact: true, quiet: true })
    expect(swarm.enhancements).toHaveLength(1)
    expect(lookalike.enhancements).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('excludedCatalogueIds', () => {
  const hiddenWhen = (conditions: object[], conditionGroups: object[] = []) =>
    ({
      id: 'd', name: 'Warhost', type: 'upgrade',
      modifiers: { modifier: [{ field: 'hidden', type: 'set', value: 'true', conditions: { condition: conditions }, conditionGroups: { conditionGroup: conditionGroups } }] },
    }) as unknown as SelectionEntry

  it('reads `instanceOf` primary-catalogue conditions on a hidden modifier', () => {
    const entry = hiddenWhen([{ type: 'instanceOf', scope: 'primary-catalogue', childId: 'drukhari', field: 'selections', value: '1' }])
    expect(excludedCatalogueIds(entry)).toEqual(['drukhari'])
  })

  it('ignores `instanceOf` inside an AND group (not sufficient on its own to hide)', () => {
    const entry = hiddenWhen([], [{ type: 'and', conditions: { condition: [{ type: 'instanceOf', scope: 'primary-catalogue', childId: 'drukhari' }] } }])
    expect(excludedCatalogueIds(entry)).toEqual([])
  })
})
