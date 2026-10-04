import { describe, it, expect } from 'vitest'
import { parseEnhancementKinds, parseRealDetachmentNames, parseStratagems } from '../wahapedia'

// ── parseEnhancementKinds ────────────────────────────────────────────────────

/**
 * Minimal HTML mirroring Wahapedia's 11e faction-page enhancement section. Two
 * detachments; the first has one Upgrade-marked card and one plain Character card, the
 * second has one plain card. Verifies grouping by the most-recent `h2.outline_header` and
 * that only Upgrade-marked names are returned.
 */
const ENH_HTML = `
<html><body>
  <h2 class="outline_header">Daemonic Incursion<span class="dpPts">2DP</span></h2>
  <h2>Detachment Rule</h2>
  <h2>Enhancements</h2>
  <div><table><tbody><tbody><tr><td class="td_w">
    <ul class="EnhancementsPts"><li><span>The Everstave<span class="EnhUpgrade">UPGRADE</span></span> <span>25 pts</span></li></ul>
    <p class="ShowFluff legend2">Flavour text.</p>
    <p><b>TZEENTCH</b> model only. Add 1 to Strength.</p>
  </td></tr></tbody></tbody></table></div>
  <div><table><tbody><tbody><tr><td class="td_w">
    <ul class="EnhancementsPts"><li><span>A'rgath</span> <span>20 pts</span></li></ul>
    <p class="ShowFluff legend2">More flavour.</p>
    <p>KHORNE only. Re-roll wounds.</p>
  </td></tr></tbody></tbody></table></div>

  <h2 class="outline_header">Scintillating Legion<span class="dpPts">1DP</span></h2>
  <h2>Enhancements</h2>
  <div><table><tbody><tbody><tr><td class="td_w">
    <ul class="EnhancementsPts"><li><span>Inescapable Eye</span> <span>10 pts</span></li></ul>
    <p class="ShowFluff legend2">Flavour.</p>
    <p>Bearer gains one extra Flux token.</p>
  </td></tr></tbody></tbody></table></div>
</body></html>
`

describe('parseEnhancementKinds', () => {
  it('returns only Upgrade-marked enhancement names, grouped by detachment', () => {
    const groups = parseEnhancementKinds(ENH_HTML)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Daemonic Incursion')
    expect(groups[0].upgradeNames).toEqual(['The Everstave'])
  })

  it('strips the DP badge from the detachment name and the UPGRADE marker from the enhancement name', () => {
    const groups = parseEnhancementKinds(ENH_HTML)
    expect(groups[0].name).not.toMatch(/DP/)
    expect(groups[0].upgradeNames[0]).not.toMatch(/UPGRADE/)
  })

  it('omits detachments with no Upgrade-marked cards', () => {
    const groups = parseEnhancementKinds(ENH_HTML)
    expect(groups.map((g) => g.name)).not.toContain('Scintillating Legion')
  })
})

// ── parseRealDetachmentNames ─────────────────────────────────────────────────

const REAL_DET_HTML = `
<html><body>
  <h2 class="outline_header">Awakened Dynasty<span class="dpPts"><img class="tooltip dpFD" src="/x.png">3DP</span></h2>
  <h2 class="outline_header">Annihilation Legion<span class="dpPts">2DP</span></h2>
  <h2 class="outline_header"><img class="tooltip logo3_11" src="/y.png">Boarding Actions</h2>
</body></html>
`

describe('parseRealDetachmentNames', () => {
  it('collects names of headers carrying a DP badge', () => {
    const names = parseRealDetachmentNames(REAL_DET_HTML)
    expect(names).toEqual(new Set(['Awakened Dynasty', 'Annihilation Legion']))
  })

  it('excludes alt-game-mode headers with no DP badge', () => {
    const names = parseRealDetachmentNames(REAL_DET_HTML)
    expect(names.has('Boarding Actions')).toBe(false)
  })
})

// ── parseStratagems ───────────────────────────────────────────────────────────

function stratCard(name: string, type: string, cp: string, bodyHtml: string): string {
  return `
  <div class="str11Wrap">
    <div class="str11Name">${name}</div>
    <div class="str11Type">${type}</div>
    <div class="str11CP">${cp}</div>
    <div class="str11Text">${bodyHtml}</div>
  </div>`
}

describe('parseStratagems', () => {
  it('groups cards by detachment name split from the dashed type line', () => {
    const html = stratCard(
      'PROTOCOL OF THE ETERNAL REVENANT',
      'Awakened Dynasty – Epic Deed Stratagem',
      '1CP',
      '<b>WHEN:</b> Any phase.<br><br><b>TARGET:</b> One model.<br><br><b>EFFECT:</b> Do the thing.',
    )
    const groups = parseStratagems(html, 'Necrons')
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Awakened Dynasty')
    expect(groups[0].stratagems[0]).toMatchObject({
      name: 'Protocol of the Eternal Revenant',
      cp: 1,
      timing: 'Any phase.',
      cond: 'One model.',
      effect: 'Do the thing.',
    })
  })

  it('strips a trailing "Stratagem" suffix when the type line has no dash (11e single-category detachments)', () => {
    const html = stratCard(
      'HAND OF THE DYNASTY',
      'Hand of the Dynasty Stratagem',
      '1CP',
      '<b>WHEN:</b> Any phase.<br><br><b>EFFECT:</b> Do the thing.',
    )
    const groups = parseStratagems(html, 'Necrons')
    expect(groups[0].name).toBe('Hand of the Dynasty')
  })

  it('strips a trailing rule-reference marker (h_number) fused onto the card name', () => {
    const html = stratCard(
      'COMMAND RE-ROLL<span class="h_number">15.02</span>',
      'Core Stratagem',
      '1CP',
      '<b>WHEN:</b> Any phase.<br><br><b>EFFECT:</b> Re-roll.',
    )
    const groups = parseStratagems(html, 'Necrons')
    expect(groups[0].stratagems[0].name).toBe('Command Re-roll')
  })

  it('folds unrecognized bold section labels (11e movement/shooting sub-headers) into effect instead of dropping them', () => {
    const html = stratCard(
      'SNAP SHOOTING',
      'Reaction Stratagem',
      '1CP',
      '<b>ELIGIBLE IF:</b> As stated in the rule.<br><b>EFFECT:</b> Your unit shoots.<br><b>WHILE SHOOTING:</b> Only one target.',
    )
    const groups = parseStratagems(html, 'Necrons')
    const effect = groups[0].stratagems[0].effect
    expect(effect).toContain('Eligible If: As stated in the rule.')
    expect(effect).toContain('Your unit shoots.')
    expect(effect).toContain('While Shooting: Only one target.')
  })

  it('survives Wahapedia\'s misnested bold tooltips without losing the card or its neighbours', () => {
    // Real shapes from the AdMech page: a <b> nested in <b> that straddles spans, and a lone <b>
    // that opens and closes inside different spans. Unrepaired, node-html-parser unwinds the
    // card's <div>s and both cards vanish.
    const html =
      stratCard(
        'ECHOES OF THE CONDUIT WARS',
        'Luminen Auto-choir Stratagem',
        '1CP',
        '<b>WHEN:</b> When a unit is <b><span class="tip"><span class="tt"><b>selected</span> <span class="tt">to</span> <span class="tt">attack</b></span></span></b>.<br><br><b>EFFECT:</b> Re-roll.',
      ) +
      stratCard(
        'DEFECT SCRUTINY',
        'Cohort Acquisitus Stratagem',
        '1CP',
        '<b>WHEN:</b> Your Shooting phase.<br><br><b>EFFECT:</b> Attacks have <span class="kwb"><span class="tip"><span class="tt"><b>[IGNORES</span> <span class="tt">COVER]</b></span></span></span>.',
      )
    const groups = parseStratagems(html, 'Adeptus Mechanicus')
    expect(groups.map((g) => g.name)).toEqual(['Luminen Auto-choir', 'Cohort Acquisitus'])
    expect(groups[0].stratagems[0]).toMatchObject({ timing: 'When a unit is selected to attack.', effect: 'Re-roll.' })
    expect(groups[1].stratagems[0].effect).toBe('Attacks have [IGNORES COVER].')
  })

  it('separates list items and nested +CP option blocks instead of fusing sentences', () => {
    const html = stratCard(
      'MOW ’EM DOWN',
      'War Horde Stratagem',
      '1CP',
      '<b>EFFECT:</b> Roll one D3:<br><ul><li>Suffer mortal wounds.</li><li><u>Or:</u> No longer <b>battle-shocked</b>.</li></ul>' +
        '<div class="str11Text2"><div class="str11CP2">+1CP</div><u>Or:</u> Re-roll.</div>',
    )
    const effect = parseStratagems(html, 'Orks')[0].stratagems[0].effect
    expect(effect).toBe('Roll one D3: Suffer mortal wounds. Or: No longer battle-shocked. +1CP Or: Re-roll.')
  })

  it('reads cards whose WHEN/TARGET/EFFECT labels are plain text rather than <b>-wrapped', () => {
    const html = stratCard(
      'EXPENDABLE BIOMASS',
      'Tyranid Attack – Strategic Ploy Stratagem',
      '1CP',
      'WHEN: Your <a href="#">Shooting phase</a>.<br><br>TARGET: One <span class="kwb">TYRANID</span> unit from your army.<br><br>EFFECT: Until the end of the phase, your unit can shoot: nothing here is a TYRANID: label.',
    )
    const strat = parseStratagems(html, 'Tyranids')[0].stratagems[0]
    expect(strat.timing).toBe('Your Shooting phase.')
    expect(strat.cond).toBe('One TYRANID unit from your army.')
    expect(strat.effect).toBe('Until the end of the phase, your unit can shoot: nothing here is a TYRANID: label.')
  })

  it('reads labels whose colon falls outside the bold tag (<b>WHEN</b>:)', () => {
    const html = stratCard(
      'STORM OF DARKNESS',
      'Traitoris Lance – Strategic Ploy Stratagem',
      '1CP',
      '<b>WHEN</b>: Your opponent’s Shooting phase.<br><br><b>TARGET:</b> One unit.<br><br><b>EFFECT</b>:<br><ul><li>Your unit has Stealth.</li><li>Melee attacks have -1 to hit.</li></ul>',
    )
    const strat = parseStratagems(html, 'Chaos Knights')[0].stratagems[0]
    expect(strat.timing).toBe('Your opponent’s Shooting phase.')
    expect(strat.cond).toBe('One unit.')
    expect(strat.effect).toBe('Your unit has Stealth. Melee attacks have -1 to hit.')
  })
})
