import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { toRoster } from '../adapter'
import { FactionArtifactSchema } from '../../ingest/normalize'
import type { Detachment, FactionArtifact } from '../../dataModel'

// These fixtures are the committed ingest artifacts — a failure here means
// the ingest regressed and dropped a unit that must always be present.

import dwArtifactRaw from '../../../public/data/factions/deathwatch.json'
import csmArtifactRaw from '../../../public/data/factions/chaos-space-marines.json'
import ironHandsArtifactRaw from '../../../public/data/factions/iron-hands.json'
import bloodAngelsArtifactRaw from '../../../public/data/factions/blood-angels.json'
import gscArtifactRaw from '../../../public/data/factions/genestealer-cults.json'
import drukhariArtifactRaw from '../../../public/data/factions/drukhari.json'
import blackTemplarsArtifactRaw from '../../../public/data/factions/black-templars.json'

describe('Deathwatch artifact', () => {
  const artifact = FactionArtifactSchema.parse(dwArtifactRaw)

  it('contains Deathwatch Terminator Squad', () => {
    const names = artifact.units.map((u) => u.name)
    expect(names).toContain('Deathwatch Terminator Squad')
  })

  it('surfaces Deathwatch Terminator Squad in every roster phase', () => {
    const roster = toRoster(artifact)
    for (const phase of Object.values(roster)) {
      const names = phase.map((u) => u.name)
      expect(names).toContain('Deathwatch Terminator Squad')
    }
  })
})

describe('Chaos Space Marines artifact', () => {
  const artifact = FactionArtifactSchema.parse(csmArtifactRaw)

  it('contains Fabius Bile', () => {
    const names = artifact.units.map((u) => u.name)
    expect(names).toContain('Fabius Bile')
  })

  it('attributes the "Raiders"-commented enhancements to Renegade Raiders, not Murdertalon Raiders', () => {
    const enh = (name: string) =>
      artifact.detachments.find((d) => d.name === name)?.enhancements?.map((e) => e.name) ?? []
    expect(enh('Renegade Raiders')).toContain("Despot's Claim")
    expect(enh('Murdertalon Raiders')).not.toContain("Despot's Claim")
  })

  it('surfaces Fabius Bile in every roster phase', () => {
    const roster = toRoster(artifact)
    for (const phase of Object.values(roster)) {
      const names = phase.map((u) => u.name)
      expect(names).toContain('Fabius Bile')
    }
  })
})

describe('Iron Hands artifact', () => {
  const artifact = FactionArtifactSchema.parse(ironHandsArtifactRaw)

  // Chapter factions should include the full generic Space Marines pool, not just
  // the handful of chapter-specific characters. If this drops below ~100 it means
  // the ingest reverted to catalogue-membership filtering instead of keyword filtering.
  it('includes the generic Space Marines pool (>100 units)', () => {
    expect(artifact.units.length).toBeGreaterThan(100)
  })

  it('contains Iron Father Feirros', () => {
    const names = artifact.units.map((u) => u.name)
    expect(names).toContain('Iron Father Feirros')
  })
})

// Detachments are scoped to each faction's own catalogue(s) and gate-filtered per chapter
// (see `selectOwnedCatalogues` / `extractDetachments`). These guard against the two leaks that
// motivated that work: ally catalogues bleeding in, and the 12 SM chapters each storing the
// full 53-detachment union of every chapter's detachments.

describe('Detachment scoping', () => {
  const ironHands = FactionArtifactSchema.parse(ironHandsArtifactRaw)
  const bloodAngels = FactionArtifactSchema.parse(bloodAngelsArtifactRaw)
  const gsc = FactionArtifactSchema.parse(gscArtifactRaw)
  const drukhari = FactionArtifactSchema.parse(drukhariArtifactRaw)
  const blackTemplars = FactionArtifactSchema.parse(blackTemplarsArtifactRaw)

  // Merge in shared detachment sets exactly as the runtime loader does, so the assertions below
  // see each faction's complete detachment list (inline faction-specific + shared generic Codex).
  const DATA = join(process.cwd(), 'public', 'data')
  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'))
  const loadShared = (id: string): Detachment[] => {
    const entry = manifest.sharedDetachments.find((s: { id: string }) => s.id === id)
    return JSON.parse(readFileSync(join(process.cwd(), 'public', entry.artifact), 'utf8')).detachments
  }
  const names = (a: FactionArtifact) => [
    ...(a.sharedDetachments ?? []).flatMap(loadShared),
    ...a.detachments,
  ].map((d) => d.name)

  it('gives a divisio chapter the shared Codex pool plus its own single flavoured detachment', () => {
    // 11e gives every codex-compliant chapter one reskinned variant of a generic detachment
    // (Iron Hands' "Hammer of Avernii") in addition to the shared Codex pool — unlike 10e,
    // where these chapters had no detachment of their own at all.
    expect(names(ironHands)).toContain('Gladius Task Force') // shared Codex set
    expect(names(ironHands)).toContain('Hammer of Avernii') // Iron Hands' own flavoured variant
    expect(names(ironHands)).not.toContain('Liberator Assault Group') // Blood Angels
    expect(names(ironHands)).not.toContain('Unforgiven Task Force') // Dark Angels
    expect(names(ironHands).length).toBeLessThan(20) // not the full multi-chapter union
  })

  it('gives a first-founding chapter its own detachments but not other chapters’', () => {
    expect(names(bloodAngels)).toContain('Liberator Assault Group') // its own (inline)
    expect(names(bloodAngels)).toContain('Gladius Task Force') // shared Codex
    expect(names(bloodAngels)).not.toContain('Unforgiven Task Force') // Dark Angels
    expect(names(bloodAngels)).not.toContain('Champions of Russ') // Space Wolves
  })

  it('shares the generic Codex detachments rather than inlining them per chapter', () => {
    // The generic detachments live in shared set(s), not inline on each chapter artifact. (Two
    // sets, since Black Templars is excluded from 1st Company Task Force / Librarius Conclave.)
    expect(bloodAngels.sharedDetachments?.length).toBeGreaterThan(0)
    expect(bloodAngels.detachments.map((d) => d.name)).not.toContain('Gladius Task Force')
  })

  it('keeps Drukhari and Asuryani detachments apart (no shared-library blending)', () => {
    // The Aeldari Library holds both; BSData hides the Asuryani ones from a Drukhari primary.
    expect(names(drukhari)).toContain('Realspace Raiders')
    expect(names(drukhari)).not.toContain('Warhost')
    expect(names(drukhari)).not.toContain('Aspect Host')
  })

  it('drops Codex detachments BSData hides from a specific chapter', () => {
    expect(names(blackTemplars)).toContain('Gladius Task Force')
    expect(names(blackTemplars)).not.toContain('Librarius Conclave')
    expect(names(blackTemplars)).not.toContain('1st Company Task Force')
    expect(names(bloodAngels)).toContain('Librarius Conclave')
  })

  it('does not leak ally-catalogue detachments into Genestealer Cults', () => {
    expect(names(gsc)).toContain('Outlander Claw') // its own
    expect(names(gsc)).not.toContain('Combined Arms') // Astra Militarum
    expect(names(gsc)).not.toContain('Invasion Fleet') // Tyranids
  })
})

describe('Committed data quality (all factions)', () => {
  const dir = join(process.cwd(), 'public', 'data')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    factions: { factionId: string }[]
  }
  const shared = new Map<string, { detachments: Detachment[] }>()
  const sharedFor = (id: string) => {
    if (!shared.has(id)) shared.set(id, JSON.parse(readFileSync(join(dir, 'shared', `${id}.json`), 'utf8')))
    return shared.get(id)!
  }
  const all = manifest.factions.map(({ factionId }) => {
    const artifact = JSON.parse(readFileSync(join(dir, 'factions', `${factionId}.json`), 'utf8')) as FactionArtifact
    const detachments = [
      ...artifact.detachments,
      ...(artifact.sharedDetachments ?? []).flatMap((id) => sharedFor(id).detachments),
    ]
    return { factionId, artifact, detachments }
  })

  it('has enhancements for every faction that has detachments', () => {
    // Regression: the nested "Enhancements → <Detachment> Enhancements" BSData layout used to be
    // missed, leaving Orks / Grey Knights / T'au / Tyranids / GSC / Agents with none.
    const empty = all
      .filter(({ detachments }) => detachments.length > 0)
      .filter(({ detachments }) => detachments.every((d) => !d.enhancements?.length))
      .map(({ factionId }) => factionId)
    expect(empty).toEqual([])
  })

  it('gives Orks their War Horde enhancement and flags upgrade-kind ones', () => {
    const orks = all.find((f) => f.factionId === 'orks')!
    const warHorde = orks.detachments.find((d) => d.name === 'War Horde')
    expect(warHorde?.enhancements?.map((e) => e.name)).toContain("Da Boss Is Watchin'")
    expect(orks.detachments.flatMap((d) => d.enhancements ?? []).some((e) => e.kind === 'upgrade')).toBe(true)
  })

  it('flags all three Orks army rules', () => {
    const orks = all.find((f) => f.factionId === 'orks')!
    expect(orks.artifact.glossary.filter((g) => g.armyRule).map((g) => g.name).sort()).toEqual(
      ['Da Boss', 'Unstable Energies', 'Waaagh!'].sort(),
    )
  })

  it('gives every stratagem timing, effect and a summary (no scraper label loss)', () => {
    const thin = all.flatMap(({ factionId, detachments }) =>
      detachments.flatMap((d) =>
        (d.stratagems ?? [])
          .filter((s) => !s.timing || !s.effect || !s.summary)
          .map((s) => `${factionId} / ${d.name} / ${s.name}`),
      ),
    )
    expect(thin).toEqual([])
  })

  it('has no stray whitespace in names or stat values', () => {
    const bad: string[] = []
    const walk = (node: unknown, where: string, key?: string) => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, where))
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && k === 'name' && (v !== v.trim() || /\s{2,}/.test(v))) bad.push(`${where}: name ${JSON.stringify(v)}`)
        else if (typeof v === 'string' && key === 'stats' && v !== v.trim()) bad.push(`${where}: stat ${k}=${JSON.stringify(v)}`)
        else walk(v, where, k)
      }
    }
    for (const { factionId, artifact } of all) walk(artifact, factionId)
    expect(bad.slice(0, 10)).toEqual([])
  })
})
