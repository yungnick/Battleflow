import { norm } from './normalize'

export type ParsedUnit = {
  name: string
  points?: number
  /** Weapon names extracted from count-prefixed bullets (Nx ...) and indented sub-model lines. */
  wargear: string[]
  /** Enhancement names from bare-name or (+N pts) bullets without a count prefix. */
  enhancements: string[]
}

export type ParsedArmy = {
  /** Faction keyword from [BRACKETS] — taken from the +++ header if present, otherwise the first bracket group in the opening lines. */
  factionKeyword: string
  detachment?: string
  totalPoints?: number
  units: ParsedUnit[]
}

// Matches section headers: CHARACTERS, BATTLELINE, OTHER DATASHEETS, etc.
const SECTION_RE = /^(CHARACTERS?|BATTLELINE|OTHER DATASHEETS?|EPIC HEROES?|DEDICATED TRANSPORTS?|ALLIED UNITS?|REINFORCEMENTS?)$/i

// Matches any line containing a parenthetical point value: "(2000 Points)", "(65 pts)", "(2 000 Points)"
const HAS_POINTS_RE = /\(\s*\d[\d\s,]*\s*(?:Points?|pts?)\s*\)/i

// Matches a unit name line "Name (N pts)" or "Name (N Points)" — number must have no embedded spaces
const UNIT_NAME_RE = /^(.+?)\s*\((\d[\d,]*)\s*(?:Points?|pts?)\)\s*$/i

// Matches a detachment line carrying a "(N Detachment Points)" suffix, as emitted by the
// GW Warhammer 40,000 App's plain-text export (distinct from a unit/army "(N Points)" line).
const DETACHMENT_POINTS_RE = /^(.+?)\s*\(\s*\d[\d\s,]*\s*Detachment Points?\s*\)\s*$/i

/**
 * Parse the GW My Army app text export, the New Recruit / BattleScribe army list format,
 * the BattleBase export format, or the New Recruit app plain-text export format.
 *
 * GW My Army skeleton:
 *   +++ Army Name [FACTION KEYWORD] (N pts) +++
 *   == Detachment Name ==
 *   SECTION HEADER
 *   Unit Name (N pts)
 *   • Nx Weapon
 *     ◦ Sub-weapon        ← indented sub-model line → wargear
 *   • Enhancement (+N pts)
 *
 * New Recruit / BattleScribe skeleton:
 *   + FACTION KEYWORD: CHAOS DAEMONS +
 *   + DETACHMENT: Daemonic Incursion (Warp Rifts) +
 *   + TOTAL ARMY POINTS: 1995pts +
 *   Unit Name (N pts)
 *   • Nx Weapon
 *
 * BattleBase / New Recruit app (plain-text) skeleton:
 *   Army Name (N Points)
 *   Faction Name
 *   Detachment Name
 *   Formation (N Points)
 *   CHARACTERS
 *   Unit Name (N Points)
 *       • Nx Weapon            ← all bullets are uniformly indented
 *           ◦ Sub-weapon       ← sub-model bullets are deeper
 *       • Enhancement: Name    ← enhancement prefix instead of (+N pts)
 *
 * Format is detected automatically: `+ KEY: value +` lines → New Recruit structured;
 * `+++` header → GW My Army; otherwise → plain-text (BattleBase / NR app).
 */
export function parseGwText(raw: string): ParsedArmy {
  const lines = raw.split('\n')

  // Plain-text formats (BattleBase / NR app) have neither NR `+ KEY:` headers nor `+++` GW headers.
  const hasNrHeaders = lines.some(l => /^\+\s+FACTION KEYWORD:/i.test(l.trim()))
  const hasGwHeader = lines.some(l => /^\+\+\+/.test(l.trim()))

  if (!hasNrHeaders && !hasGwHeader) {
    const { factionKeyword, detachment, totalPoints } = extractPlainHeader(lines)
    const units = parsePlainTextUnits(lines)
    return { factionKeyword, detachment, totalPoints, units }
  }

  let factionKeyword = ''
  let detachment: string | undefined
  let totalPoints: number | undefined

  // New Recruit / BattleScribe: `+ KEY: value +` header lines.
  // These use a single `+` prefix and a colon separator, distinct from the `+++` GW header.
  for (const l of lines) {
    const t = l.trim()
    // Matches:  + FACTION KEYWORD: CHAOS DAEMONS +   (trailing + is optional)
    const nrKw = t.match(/^\+\s+FACTION KEYWORD:\s*(.+?)\s*\+?\s*$/i)
    if (nrKw && !factionKeyword) { factionKeyword = nrKw[1].trim(); continue }

    const nrDet = t.match(/^\+\s+DETACHMENT:\s*(.+?)\s*\+?\s*$/i)
    if (nrDet && !detachment) { detachment = nrDet[1].trim(); continue }

    const nrPts = t.match(/^\+\s+TOTAL ARMY POINTS:\s*(\d[\d,]*)\s*pts?\s*\+?\s*$/i)
    if (nrPts && totalPoints === undefined) {
      totalPoints = parseInt(nrPts[1].replace(/,/g, ''), 10)
    }
  }

  // GW My Army: extract from +++ header line if New Recruit didn't supply values.
  if (!factionKeyword || totalPoints === undefined) {
    const headerLine = lines.find(l => /^\+\+\+/.test(l.trim()))
    if (headerLine) {
      if (!factionKeyword) {
        const kwMatch = headerLine.match(/\[([^\]]+)\]/)
        if (kwMatch) factionKeyword = kwMatch[1].trim()
      }
      if (totalPoints === undefined) {
        const ptsMatch = headerLine.match(/\((\d[\d,]*)\s*pts?\)/i)
        if (ptsMatch) totalPoints = parseInt(ptsMatch[1].replace(/,/g, ''), 10)
      }
    }
  }

  // Fallback: scan the opening lines for a [BRACKET] group in case the +++ wrapper is absent.
  // Capped at 10 lines so we don't pick up ability annotations deeper in the list body.
  if (!factionKeyword) {
    for (const l of lines.slice(0, 10)) {
      const m = l.match(/\[([^\]]+)\]/)
      if (m) { factionKeyword = m[1].trim(); break }
    }
  }

  // GW My Army: detachment from == ... == line if New Recruit didn't supply it.
  if (!detachment) {
    const detachLine = lines.find(l => /^==\s*.+\s*==$/.test(l.trim()))
    if (detachLine) {
      detachment = detachLine.replace(/^==\s*/, '').replace(/\s*==$/, '').trim()
    }
  }

  // Group non-empty lines into blocks separated by blank lines
  const blocks: string[][] = []
  let cur: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) { blocks.push(cur); cur = [] }
    } else {
      cur.push(line)
    }
  }
  if (cur.length) blocks.push(cur)

  const units: ParsedUnit[] = []
  for (const block of blocks) {
    const unit = parseBlock(block)
    if (unit) units.push(unit)
  }

  return { factionKeyword, detachment, totalPoints, units }
}

/**
 * Extract faction keyword, detachment, and total points from the preamble of a
 * plain-text format (BattleBase / NR app). Scans lines until it hits a section
 * header (CHARACTERS, BATTLELINE, …) or the first indented bullet, then:
 *   - lines with a parenthetical point value → army name or formation (skipped for
 *     faction detection; the first one supplies totalPoints)
 *   - a line with a "(N Detachment Points)" suffix → the detachment name itself, however
 *     many plain lines precede it. Space Marines chapter exports (GW App) put an extra
 *     umbrella line ("Space Marines") before the chapter name ("Blood Angels"), so the
 *     detachment isn't reliably the second plain line — the last plain line seen before
 *     this one is the actual chapter/faction.
 *   - all-caps lines without digits → section-header noise, skipped
 *   - otherwise: remaining lines → faction name (first), detachment (second)
 */
function extractPlainHeader(lines: string[]): {
  factionKeyword: string
  detachment: string | undefined
  totalPoints: number | undefined
} {
  const plainLines: string[] = []
  let totalPoints: number | undefined
  let detachmentPointsLine: { name: string; factionKeyword: string } | undefined

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue

    if (SECTION_RE.test(t)) break
    if (/^\s*[•◦]/.test(line)) break

    const detMatch = t.match(DETACHMENT_POINTS_RE)
    if (detMatch) {
      if (!detachmentPointsLine) {
        detachmentPointsLine = {
          name: detMatch[1].trim(),
          factionKeyword: plainLines[plainLines.length - 1] ?? plainLines[0] ?? '',
        }
      }
      continue
    }

    if (HAS_POINTS_RE.test(t)) {
      if (totalPoints === undefined) {
        const m = t.match(/\(\s*(\d[\d\s,]*)\s*(?:Points?|pts?)\s*\)/i)
        if (m) totalPoints = parseInt(m[1].replace(/[\s,]/g, ''), 10) || undefined
      }
      continue
    }

    plainLines.push(t)
  }

  return {
    factionKeyword: detachmentPointsLine?.factionKeyword || plainLines[0] || '',
    detachment: detachmentPointsLine?.name ?? plainLines[1],
    totalPoints,
  }
}

/**
 * Parse unit entries from a plain-text army list (BattleBase / NR app format).
 * Works for both compact (no blank lines between units) and spaced (blank lines)
 * variants: unit blocks are opened by any non-indented "Name (N pts)" line, and
 * closed when the next unit line or section header is encountered.
 */
function parsePlainTextUnits(lines: string[]): ParsedUnit[] {
  const units: ParsedUnit[] = []

  type Acc = { name: string; points: number | undefined; bulletLines: string[] }
  let current: Acc | null = null
  let lastBulletIndent: string | null = null

  const commit = () => {
    if (!current) return
    const unit = parsePlainBlock(current.name, current.points, current.bulletLines)
    if (unit) units.push(unit)
    current = null
    lastBulletIndent = null
  }

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue

    if (SECTION_RE.test(t)) { commit(); continue }

    // Non-indented "Name (N pts)" → start of a new unit block
    if (!/^\s/.test(line)) {
      const m = t.match(UNIT_NAME_RE)
      if (m) {
        commit()
        current = { name: m[1].trim(), points: parseInt(m[2].replace(/,/g, ''), 10), bulletLines: [] }
        continue
      }
    }

    if (!current) continue

    if (/[•◦]/.test(t)) {
      current.bulletLines.push(line)
      lastBulletIndent = line.match(/^(\s*)/)?.[1] ?? ''
      continue
    }

    // Indented line with no bullet char: the app exports only the first weapon of a
    // group on a "•" line and the rest as bare indented continuations. Treat it as a
    // sibling bullet at the previous bullet's indent.
    if (lastBulletIndent !== null && /^\s/.test(line)) {
      current.bulletLines.push(`${lastBulletIndent}• ${t}`)
    }
  }

  commit()
  return units
}

/**
 * Parse a unit's bullet lines using relative indentation.
 * The minimum indentation of all bullet lines is "top-level"; deeper = sub-model.
 * Enhancement prefix ("Enhancement:" / "Enhancements:") is recognised at top level.
 */
function parsePlainBlock(
  name: string,
  points: number | undefined,
  bulletLines: string[],
): ParsedUnit | null {
  if (!name) return null

  let minIndent = Infinity
  for (const line of bulletLines) {
    const m = line.match(/^(\s*)/)
    const indent = m ? m[1].length : 0
    if (indent < minIndent) minIndent = indent
  }
  if (!isFinite(minIndent)) minIndent = 0

  const wargear: string[] = []
  const enhancements: string[] = []

  for (const line of bulletLines) {
    const t = line.trim()
    if (!t) continue

    const bulletMatch = t.match(/^[•◦*-]\s*(.+)$/)
    if (!bulletMatch) continue

    const content = bulletMatch[1].trim()
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0

    if (indent > minIndent) {
      // Sub-model line
      const cm = content.match(/^(\d+)x\s+(.+)$/i)
      wargear.push(cm ? cm[2].trim() : content)
      continue
    }

    // Top-level bullet: Enhancement: / Enhancements: prefix
    const enhPrefix = content.match(/^Enhancements?:\s*(.+)$/i)
    if (enhPrefix) { enhancements.push(enhPrefix[1].trim()); continue }

    if (norm(content) === 'warlord') continue

    const cm = content.match(/^(\d+)x\s+(.+)$/i)
    if (cm) { wargear.push(cm[2].trim()); continue }

    // "(+N pts)" enhancement suffix
    const enhPts = content.match(/^(.+?)\s*\(\+\d+\s*pts?\)\s*$/i)
    if (enhPts) { enhancements.push(enhPts[1].trim()); continue }

    // Bare top-level bullet with no count prefix and no enhancement marker —
    // treat as an enhancement (same convention as parseBlock for GW/NR formats).
    enhancements.push(content)
  }

  return { name, points, wargear, enhancements }
}

function parseBlock(lines: string[]): ParsedUnit | null {
  const firstLine = lines[0].trim()

  // Skip GW My Army control lines (+++ / ==) and New Recruit `+ KEY: value +` lines.
  if (/^\+\+\+/.test(firstLine) || /^==/.test(firstLine)) return null
  if (/^\+\s+[A-Z].*:/i.test(firstLine)) return null

  // A valid unit first line must be "Name (N pts)"; section headers like
  // "CHARACTER" / "BATTLELINE" have no pts suffix and are all-caps — skip them.
  const unitMatch = firstLine.match(/^(.+?)\s*\((\d[\d,]*)\s*pts?\)\s*$/i)
  let name: string
  let points: number | undefined

  if (unitMatch) {
    name = unitMatch[1].trim()
    points = parseInt(unitMatch[2].replace(/,/g, ''), 10)
  } else {
    // Section headers like "CHARACTER" / "BATTLELINE" are all-caps with no digits.
    // Require both conditions so all-caps unit names (if they exist) aren't dropped.
    if (/^[A-Z\s]+$/.test(firstLine) && !/\d/.test(firstLine)) return null
    name = firstLine
  }
  if (!name) return null

  const wargear: string[] = []
  const enhancements: string[] = []

  for (const line of lines.slice(1)) {
    const trimmed = line.trim()

    // Indented lines (sub-model bullets) are wargear regardless of bullet char.
    // "Indented" means the raw line starts with whitespace before the bullet.
    const isIndented = line.length > trimmed.length && /^\s/.test(line)

    const bulletMatch = trimmed.match(/^[•◦*-]\s*(.+)$/)
    if (!bulletMatch) continue

    const content = bulletMatch[1].trim()

    if (isIndented) {
      // Strip optional count prefix on sub-model lines
      const cm = content.match(/^(\d+)x\s+(.+)$/i)
      wargear.push(cm ? cm[2].trim() : content)
      continue
    }

    // Warlord marker → discard
    if (norm(content) === 'warlord') continue

    // Count-prefixed bullet → wargear
    const cm = content.match(/^(\d+)x\s+(.+)$/i)
    if (cm) {
      wargear.push(cm[2].trim())
      continue
    }

    // Bare name or "Name (+N pts)" → enhancement
    const enhMatch = content.match(/^(.+?)\s*\(\+\d+\s*pts?\)\s*$/i)
    enhancements.push(enhMatch ? enhMatch[1].trim() : content)
  }

  return { name, points, wargear, enhancements }
}
