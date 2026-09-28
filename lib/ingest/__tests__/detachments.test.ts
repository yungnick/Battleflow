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
