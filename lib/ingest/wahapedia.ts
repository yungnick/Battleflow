import { parse, type HTMLElement } from 'node-html-parser'
import type { Strat } from '../types'

/**
 * Offline Wahapedia stratagem scraper.
 *
 * BSData does not model stratagems as machine-readable profiles, so faction stratagems
 * are sourced separately from wahapedia.ru's static, server-rendered faction pages. Each
 * stratagem is a `.str11Wrap` card; the cards are grouped under detachment headings encoded
 * in the card's type line (e.g. "Hallowed Martyrs – Epic Deed Stratagem"). This module
 * fetches a faction page and returns one `Strat[]` per detachment group.
 *
 * 11e enhancements now come from BSData (docs/11e-migration-plan.md Phase 4) — this module's
 * enhancement-related role has narrowed to flagging the "Upgrade" subtype (see
 * {@link parseEnhancementKinds} below), not extracting rules text.
 *
 * Run-once at ingest time only — never on the request path.
 */

const WAHAPEDIA_BASE = 'https://wahapedia.ru/wh40k11ed/factions'

/** Identify the offline scraper so Wahapedia can attribute (and rate-limit) it fairly. */
const USER_AGENT =
  'battleflow-ingest (offline faction-data prep; https://github.com/yungnick/Battleflow)'

/** Stratagems for one detachment, keyed by the detachment's display name. */
export type DetachmentStratagems = { name: string; stratagems: Strat[] }

/**
 * Fetch a faction's Wahapedia page HTML with a respectful User-Agent. The trailing slash
 * matters for `space-marines`: with it, the page renders its "No filter" view (every chapter's
 * supplement detachments included); without it, the server defaults to the codex-only "No
 * supplements" view and chapter-specific detachments are absent from the HTML entirely
 * (confirmed live, 2026-08-25). All other faction slugs are unaffected either way.
 */
export async function fetchFactionPage(slug: string): Promise<string> {
  const res = await fetch(`${WAHAPEDIA_BASE}/${slug}/`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch Wahapedia page for "${slug}" (HTTP ${res.status}).`)
  }
  return res.text()
}

/** Parse an integer CP cost from strings like "1CP", "2 CP". Defaults to 1. */
function parseCp(raw: string): number {
  const m = raw.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}

/** Infer the usage restriction from a stratagem's combined prose. */
function parseOnce(text: string): 'battle' | 'phase' | false {
  const t = text.toLowerCase()
  if (t.includes('once per battle')) return 'battle'
  if (t.includes('once per phase') || t.includes('once per turn')) return 'phase'
  return false
}

/** Words kept lowercase mid-title when normalizing Wahapedia's ALL-CAPS names. */
const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'with',
])

/**
 * Normalize Wahapedia's shouty ALL-CAPS titles to the Title Case used by the rest of
 * the dataset (matching `coreStratagems.ts`), e.g. "TO THE HEART OF HERESY" →
 * "To the Heart of Heresy".
 */
function toTitleCase(name: string): string {
  const words = name.toLowerCase().split(/\s+/)
  return words
    .map((w, i) => {
      if (i > 0 && TITLE_MINOR_WORDS.has(w)) return w
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

/**
 * Repair Wahapedia's misnested bold markup. Keyword tooltips come out as e.g.
 * `<b><span><span><b>selected</span> … attack</b></span></span></b>` or
 * `<span><span><b>[IGNORES</span> <span>COVER]</b></span></span>` — a `<b>` that opens and closes
 * inside different `<span>`s. Browsers repair that; node-html-parser instead unwinds the
 * enclosing `<div>`s, detaching the rest of the card from its `.str11Wrap` so the stratagem is
 * silently lost (e.g. all of AdMech's Luminen Auto-choir). Such `<b>` pairs — and any `<b>`
 * nested inside another `<b>` — are purely cosmetic, so both tags are dropped; well-formed
 * top-level labels like `<b>WHEN:</b>` are untouched.
 */
function repairBoldNesting(html: string): string {
  const drop = new Set<number>()
  const open: { at: number; span: number; nested: boolean }[] = []
  const spans: number[] = [] // stack of open-span ids; a `<b>` must close inside the span it opened in
  let nextSpan = 1
  for (const m of html.matchAll(/<(\/?)(b|span)\b[^>]*>/gi)) {
    const closing = m[1] === '/'
    const top = spans.at(-1) ?? 0
    if (m[2].toLowerCase() === 'span') {
      if (closing) spans.pop()
      else spans.push(nextSpan++)
    } else if (!closing) {
      open.push({ at: m.index!, span: top, nested: open.length > 0 })
    } else {
      const b = open.pop()
      if (b && (b.nested || b.span !== top)) {
        drop.add(b.at)
        drop.add(m.index!)
      }
    }
  }
  if (drop.size === 0) return html
  return html.replace(/<\/?b>/gi, (tag, offset: number) => (drop.has(offset) ? '' : tag))
}

/** Parse a Wahapedia page (or fragment) after repairing its known misnesting. */
function parsePage(html: string) {
  return parse(repairBoldNesting(html))
}

/** Decode an HTML fragment to clean, single-spaced plain text. */
function htmlToText(html: string): string {
  // Convert <br> and block-level tag boundaries (11e effects are often `<ul><li>` option lists,
  // and "+1CP" upgrades sit in nested <div>s) to spaces so text either side doesn't fuse;
  // parse() then strips the remaining tags (tooltips, keyword spans, links) and decodes entities.
  return parse(html.replace(/<br\s*\/?>|<\/?(?:li|ul|ol|div|p)\b[^>]*>/gi, ' '))
    .text.replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract an element's own display text, stripping a trailing footnote/rule-reference marker
 * nested inside it (e.g. 11e's core-rules cards render `<div class="str11Name">COMMAND
 * RE-ROLL<span class="h_number">15.02</span></div>` — without stripping, the number fuses
 * onto the name). Generalized rather than `.h_number`-specific so any nested trailing marker
 * span is handled the same way (also reused for the `EnhUpgrade` marker below).
 */
function textWithoutTrailingMarker(el: HTMLElement | null, markerSelector: string): string {
  if (!el) return ''
  let text = el.text.trim()
  const marker = el.querySelector(markerSelector)
  if (marker) {
    const markerText = marker.text.trim()
    if (markerText && text.endsWith(markerText)) {
      text = text.slice(0, text.length - markerText.length).trim()
    }
  }
  return text
}

/**
 * Split a `.str11Text` body into WHEN / TARGET / RESTRICTION(S) / everything-else. 11e adds
 * granular sub-headers beyond the 10e set (`ELIGIBLE IF`, `BEFORE/WHILE/AFTER MOVING`,
 * `MAXIMUM DISTANCE`, `WHILE/AFTER SHOOTING`, …) on movement/shooting-styled stratagems —
 * rather than hardcode the full label list, any bold header not WHEN/TARGET/RESTRICTION(S) is
 * folded into the effect text (prefixed with its own label, since our schema has no field for
 * it), so no content is silently dropped when Wahapedia introduces another one.
 */
function splitSections(bodyHtml: string): {
  timing: string
  cond: string | undefined
  effect: string
  restrictions: string
} {
  const re = /<b>\s*([A-Z][A-Z ]*?)\s*:\s*<\/b>/g
  const marks: { label: string; bodyStart: number; labelStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(bodyHtml))) {
    marks.push({ label: m[1].trim(), labelStart: m.index, bodyStart: re.lastIndex })
  }

  let timing = ''
  let cond = ''
  const effectParts: string[] = []
  const restrictionsParts: string[] = []

  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].labelStart : bodyHtml.length
    const text = htmlToText(bodyHtml.slice(marks[i].bodyStart, end))
    if (!text) continue
    const label = marks[i].label
    if (label === 'WHEN') timing = text
    else if (label === 'TARGET') cond = text
    else if (label === 'RESTRICTION' || label === 'RESTRICTIONS') restrictionsParts.push(text)
    else if (label === 'EFFECT') effectParts.push(text)
    else effectParts.push(`${toTitleCase(label)}: ${text}`)
  }

  return { timing, cond: cond || undefined, effect: effectParts.join(' '), restrictions: restrictionsParts.join(' ') }
}

/**
 * Resolve a stratagem card's detachment/group name from its `.str11Type` line. Most cards
 * follow 10e's "<Detachment> – <Category> Stratagem" shape; 11e also has bare "<Detachment>
 * Stratagem" cards with no dash (single-category detachments and the universal "Core
 * Stratagem" marker) — strip the trailing "Stratagem(s)" word instead of dash-splitting for
 * those so the group name still matches the detachment's real name (and "Core" still hits
 * `SKIP_GROUPS` in wahapediaCli.ts).
 */
function parseGroupName(typeText: string): string {
  const dashSplit = typeText.split(/\s+[–—-]\s+/)
  if (dashSplit.length > 1) return dashSplit[0].trim()
  return typeText.replace(/\s+Stratagems?$/i, '').trim()
}

/** Parse one `.str11Wrap` card into a `Strat` plus the detachment group it belongs to. */
function parseCard(card: HTMLElement, source: string): { group: string; strat: Strat } | null {
  const name = textWithoutTrailingMarker(card.querySelector('.str11Name'), '.h_number')
  if (!name) return null

  const typeText = card.querySelector('.str11Type')?.text.trim() ?? ''
  const group = parseGroupName(typeText)
  if (!group) return null

  const cpText = card.querySelector('.str11CP')?.text ?? ''
  const bodyHtml = card.querySelector('.str11Text')?.innerHTML ?? ''
  const s = splitSections(bodyHtml)

  const strat: Strat = {
    name: toTitleCase(name),
    cp: parseCp(cpText),
    timing: s.timing,
    cond: s.cond,
    effect: s.effect,
    once: parseOnce([s.timing, s.restrictions, s.effect].filter(Boolean).join(' ')),
    source,
  }
  return { group, strat }
}

/**
 * Parse all stratagem cards from a faction page's HTML, grouped by detachment in the order
 * they first appear. `source` is the faction display name, recorded on each `Strat`.
 */
export function parseStratagems(html: string, source: string): DetachmentStratagems[] {
  const groups = new Map<string, Strat[]>()
  for (const card of parsePage(html).querySelectorAll('.str11Wrap')) {
    const parsed = parseCard(card, source)
    if (!parsed) continue
    const list = groups.get(parsed.group) ?? []
    list.push(parsed.strat)
    groups.set(parsed.group, list)
  }
  return [...groups.entries()].map(([name, stratagems]) => ({ name, stratagems }))
}

/** Fetch + parse a faction's Wahapedia stratagems in one step. */
export async function scrapeFaction(slug: string, source: string): Promise<DetachmentStratagems[]> {
  return parseStratagems(await fetchFactionPage(slug), source)
}

// ─────────────────────────────────────────────────────────────────────────
// Real-detachment signal (for stratagem-group synthesis gating)
//
// Every genuine detachment's `<h2 class="outline_header">` heading carries a Detachment
// Points badge (`<span class="dpPts">`, e.g. "Awakened Dynasty<span class="dpPts">...3DP
// </span>"); Boarding Action / Crusade-mode alt-game-mode listings don't. This replaces the
// old 10e "does an enhancement table exist for this name" heuristic now that enhancement
// text no longer comes from this scrape (see docs/11e-migration-plan.md Phase 6).
// ─────────────────────────────────────────────────────────────────────────

/** Names of every real (non-alt-game-mode) detachment on a faction page. */
export function parseRealDetachmentNames(html: string): Set<string> {
  const root = parsePage(html)
  const names = new Set<string>()
  for (const h2 of root.querySelectorAll('h2.outline_header')) {
    const badge = h2.querySelector('.dpPts')
    if (!badge) continue
    const name = textWithoutTrailingMarker(h2, '.dpPts')
    if (name) names.add(name)
  }
  return names
}

// ─────────────────────────────────────────────────────────────────────────
// Enhancement "Upgrade" subtype marker
//
// Enhancement rules text is now BSData-sourced (Phase 4). This scrape's only remaining
// enhancement-related job is flagging which enhancements are the "Upgrade" subtype (attaches
// to a unit rather than a Character) via a `<span class="EnhUpgrade">` marker nested in the
// enhancement's name `<span>` — matched onto the BSData-sourced enhancement by name in
// wahapediaCli.ts. Detachment grouping is implicit in document order: each `<h2
// class="outline_header">` names the detachment whose enhancement cards follow it, until the
// next outline header (same structure the old full-text enhancement scraper relied on).
// ─────────────────────────────────────────────────────────────────────────

/** Upgrade-subtype enhancement names for one detachment, keyed by the detachment's display name. */
export type DetachmentEnhancementKinds = { name: string; upgradeNames: string[] }

/** Parse one `ul.EnhancementsPts` card's name and whether it carries the Upgrade marker. */
function parseEnhancementNameCard(ul: HTMLElement): { name: string; upgrade: boolean } | null {
  const li = ul.querySelector('li')
  if (!li) return null
  const nameSpan = li.querySelector('span')
  if (!nameSpan) return null
  const marker = nameSpan.querySelector('.EnhUpgrade')
  const name = textWithoutTrailingMarker(nameSpan, '.EnhUpgrade')
  if (!name) return null
  return { name, upgrade: !!marker }
}

/**
 * Parse all Upgrade-marked enhancement names from a faction page's HTML, grouped by
 * detachment in the order they first appear. Character-subtype (unmarked) enhancements are
 * not included — `EnhancementSchema.kind` is absent/undefined for those, the common case.
 */
export function parseEnhancementKinds(html: string): DetachmentEnhancementKinds[] {
  const root = parsePage(html)
  const groups = new Map<string, string[]>()
  let currentDet: string | null = null

  for (const node of root.querySelectorAll('h2.outline_header, ul.EnhancementsPts')) {
    if (node.tagName === 'H2') {
      currentDet = textWithoutTrailingMarker(node, '.dpPts') || node.text.trim()
      continue
    }
    if (!currentDet) continue
    const parsed = parseEnhancementNameCard(node)
    if (!parsed || !parsed.upgrade) continue
    const list = groups.get(currentDet) ?? []
    list.push(parsed.name)
    groups.set(currentDet, list)
  }

  return [...groups.entries()].map(([name, upgradeNames]) => ({ name, upgradeNames }))
}
