import {
  fetchRaw,
  getLatestRef,
  listDataFiles,
  resolveRef,
} from './fetch'
import { parseCatalogue11, parseGameSystem11 } from '../parsers/bsdata11'
import {
  buildIndex,
  collectCrusadeIds,
  collectGstProfileTypes,
  collectGstRuleIds,
  enumerateUnits,
} from './resolve'
import { allDetachmentEntryIds, extractDetachments, legalDetachmentEntries, selectOwnedCatalogues } from './detachments'
import { collectForceEntryIds, type VisibilityContext } from './visibility'
import { toFactionArtifact } from './normalize'
import { prepareArtifact, writeArtifact, writeManifest, type EmitResult } from './emit'
import { DATA_SCHEMA_VERSION, type DataManifest } from '../dataModel'
import { deriveFactionKeywords, type ChainEntry } from './keywords'

type Args = { ref?: string; factions: string[] | 'all'; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { factions: 'all', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') args.ref = argv[++i]
    else if (a === '--factions') {
      const v = argv[++i]
      args.factions = v === 'all' ? 'all' : v.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (a === '--dry-run') args.dryRun = true
  }
  return args
}

/** Fetch + parse a catalogue JSON file at a pinned sha. */
async function fetchCatalogue(sha: string, filename: string) {
  return parseCatalogue11(JSON.parse(await fetchRaw(sha, filename)))
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** "Imperium - Space Marines.json" -> "space-marines"; "Necrons.json" -> "necrons". */
function factionSlug(filename: string): string {
  const stem = filename.replace(/\.json$/, '')
  const last = stem.split(' - ').pop() ?? stem
  return slugify(last)
}

function isFactionFile(filename: string): boolean {
  if (/library/i.test(filename)) return false
  if (filename === 'Unaligned Forces.json') return false
  return true
}

/** Resolve a catalogueLink targetId to a filename, guessing by name first, then scanning. */
async function makeFileFinder(sha: string, allCatFiles: string[]) {
  const idToFile = new Map<string, string>()
  const scanned = new Set<string>()
  return async function findFileById(targetId: string, name: string): Promise<string | undefined> {
    if (idToFile.has(targetId)) return idToFile.get(targetId)
    const guess = `${name}.json`
    const ordered = allCatFiles.includes(guess)
      ? [guess, ...allCatFiles.filter((f) => f !== guess)]
      : allCatFiles
    for (const file of ordered) {
      if (scanned.has(file)) continue
      scanned.add(file)
      const cat = await fetchCatalogue(sha, file)
      idToFile.set(cat.id, file)
      if (cat.id === targetId) return file
    }
    return idToFile.get(targetId)
  }
}

// ChainEntry is exported from ./keywords and imported above.

/**
 * Load a faction catalogue and every catalogue it links, transitively. `enumerateRoots`
 * marks catalogues whose top-level entries should be offered as fieldable datasheets —
 * the start catalogue plus any reached only through `importRootEntries="true"` links.
 * Catalogues linked for shared rules/profiles only still load (for the index) but their
 * roots are not enumerated.
 */
async function loadChain(
  sha: string,
  startFile: string,
  findFileById: (id: string, name: string) => Promise<string | undefined>,
): Promise<ChainEntry[]> {
  // A catalogue is enumerable if ANY path reaches it through importRootEntries links, so
  // `enumerateRoots` is ORed across paths rather than fixed by whichever link is seen first.
  // Enumerability is monotonic (false→true only), so each catalogue is expanded at most twice.
  const entries = new Map<string, ChainEntry>()
  const queue: { file: string; enumerateRoots: boolean }[] = [{ file: startFile, enumerateRoots: true }]
  while (queue.length) {
    const { file, enumerateRoots } = queue.shift()!
    const cat = await fetchCatalogue(sha, file)
    const existing = entries.get(cat.id)
    if (existing) {
      if (!enumerateRoots || existing.enumerateRoots) continue // no new enumerability to propagate
      existing.enumerateRoots = true // upgrade, then re-expand so children inherit it
    } else {
      entries.set(cat.id, { catalogue: cat, enumerateRoots })
    }
    const enumerable = entries.get(cat.id)!.enumerateRoots
    for (const link of cat.catalogueLinks?.catalogueLink ?? []) {
      const linked = await findFileById(link.targetId, link.name)
      if (linked) {
        queue.push({ file: linked, enumerateRoots: enumerable && link.importRootEntries === 'true' })
      } else {
        console.warn(`  ! unresolved catalogueLink "${link.name}" (${link.targetId})`)
      }
    }
  }
  return [...entries.values()]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const ref = args.ref ?? (await getLatestRef())
  console.log(`Ingesting BSData wh40k-11e @ ${ref}`)

  const { sha } = await resolveRef(ref)
  console.log(`  resolved ${ref} -> ${sha}`)

  const { gst: gstFile, catalogues } = await listDataFiles(sha)
  const gst = parseGameSystem11(JSON.parse(await fetchRaw(sha, gstFile)))
  const crusadeIds = collectCrusadeIds(gst)
  // Ids of every rule defined in the GST — the edition's Core abilities. Threaded into
  // unit traversal so each unit rule can be tagged Core at ingest (see resolve.ts).
  const coreRuleIds = collectGstRuleIds(gst)
  // Names of the GST's structural profile types (Unit, Abilities, Transport, …); a profile
  // type NOT in this set is a faction-defined themed ability group (see normalize.ts).
  const gstProfileTypes = collectGstProfileTypes(gst)

  const factionFiles = catalogues.filter(isFactionFile).filter((f) => {
    if (args.factions === 'all') return true
    return args.factions.includes(factionSlug(f))
  })

  if (factionFiles.length === 0) {
    console.error('No matching faction catalogues. Available slugs:')
    console.error(catalogues.filter(isFactionFile).map(factionSlug).join(', '))
    process.exit(1)
  }

  const findFileById = await makeFileFinder(sha, catalogues)

  const results: EmitResult[] = []

  for (const file of factionFiles) {
    const slug = factionSlug(file)
    process.stdout.write(`  ${slug} … `)
    const chain = await loadChain(sha, file, findFileById)
    const faction = chain[0].catalogue
    const allCats = chain.map((c) => c.catalogue)
    const index = buildIndex([gst, ...allCats], crusadeIds)
    const enumerable = chain.filter((c) => c.enumerateRoots).map((c) => c.catalogue)
    // Scope detachments to the faction's own catalogue(s), dropping the ally catalogues its
    // chain imports for roster-building, then gate-filter chapter/sub-faction detachments.
    const ownedCats = selectOwnedCatalogues(allCats, faction, index)
    const importedCats = allCats.filter((c) => !ownedCats.includes(c))
    const detachments = extractDetachments(ownedCats, index, faction.id, importedCats)
    // Honour BSData `hidden` modifiers on unit abilities (see visibility.ts): primary-catalogue
    // and force gates resolve here; detachment gates are carried onto the artifact.
    const visibility: VisibilityContext = {
      primaryCatalogueId: faction.id,
      factionDetachmentIds: legalDetachmentEntries(ownedCats, index, faction.id).map((e) => e.id),
      allDetachmentIds: allDetachmentEntryIds(allCats, index),
      forceEntryIds: collectForceEntryIds([gst, ...allCats]),
    }
    const units = enumerateUnits(enumerable, index, coreRuleIds, visibility)

    // Derive the "Faction: X" keywords that belong to this faction (see keywords.ts).
    const factionKeywords = deriveFactionKeywords(chain, units, slug, index)

    // Keep units whose faction keywords are a subset of factionKeywords. Units with NO
    // Faction: keywords (Drop Pod, Legends entries, cross-faction Epic Heroes like Fabius
    // Bile) pass vacuously — this is intentional; BSData omits faction tags on genuinely
    // faction-agnostic units. Units from unrelated ally catalogues (e.g. Dark Angels
    // characters) carry tags like "Faction: Dark Angels" that are not in factionKeywords
    // and are therefore excluded.
    const factionKwSet = new Set(factionKeywords)
    const filteredUnits = units.filter((u) => {
      const unitFactionKws = u.keywords.filter((k) => k.startsWith('Faction: '))
      return unitFactionKws.every((k) => factionKwSet.has(k))
    })
    const artifact = toFactionArtifact(faction, filteredUnits, slug, factionKeywords, detachments, gstProfileTypes)
    const result = prepareArtifact(artifact)
    results.push(result)
    if (!args.dryRun) await writeArtifact(result)
    const detStr = detachments.length > 0 ? `, ${detachments.length} detachment(s)` : ''
    console.log(`${result.unitCount} units${detStr}, ${(result.bytes / 1024).toFixed(1)} KB`)
  }

  const manifest: DataManifest = {
    schemaVersion: DATA_SCHEMA_VERSION,
    bsDataTag: ref,
    bsDataCommit: sha,
    buildTime: new Date().toISOString(),
    factions: results
      .map((r) => ({
        factionId: r.factionId,
        factionName: r.factionName,
        factionKeywords: r.factionKeywords,
        artifact: r.artifact,
        bytes: r.bytes,
        sha256: r.sha256,
        unitCount: r.unitCount,
      }))
      .sort((a, b) => a.factionName.localeCompare(b.factionName)),
  }
  if (!args.dryRun) await writeManifest(manifest)

  const totalKb = results.reduce((n, r) => n + r.bytes, 0) / 1024
  console.log(`\n${results.length} faction(s), ${totalKb.toFixed(1)} KB total${args.dryRun ? ' (dry run — nothing written)' : ' written to public/data/'}`)
}

main().catch((err) => {
  console.error('\nIngest failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
