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
