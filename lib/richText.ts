/**
 * Parser for the inline markup that rides along in rule / stratagem `effect` text.
 *
 * The source (Wahapedia-flavoured markdown) uses:
 *   `^^x^^`            unit / faction keyword (often wrapped in redundant `**`, in any nesting order)
 *   `**x**`            emphasised rules term, or an ability label when it leads a line and is followed by `:`
 *   `*x*`              italic (e.g. the `***Example:** …*` blocks)
 *   `<ins>x</ins>`     "Or:" alternative marker
 *   `- ` `▪ ` `• ` `1. `   list items (nbsp-indented ones are nested)
 *
 * `^^` and `*` runs are treated as independent toggles rather than a strict grammar, because the data
 * contains mixed / unbalanced nesting (`**^^x^^**`, `^^**x^^**`, `^^**x^^***`). The parser never throws and
 * never leaves a raw marker in its output.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'keyword'; text: string }
  | { type: 'term'; text: string }
  | { type: 'label'; text: string }
  | { type: 'em'; text: string }
  | { type: 'or'; text: string }

export interface ListItem {
  content: InlineNode[]
  /** Nested bullets that followed this item at a deeper indent. */
  children: ListItem[]
}

export type Block =
  | { type: 'paragraph'; content: InlineNode[] }
  | { type: 'example'; content: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }

interface Style { keyword: boolean; bold: boolean; italic: boolean; ins: boolean }

const LABEL_FOLLOWER = /^\s*:/

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase()
}

/** Tokenise one line into styled spans, then classify them into display nodes. */
function parseInline(line: string): InlineNode[] {
  const spans: { text: string; style: Style }[] = []
  const style: Style = { keyword: false, bold: false, italic: false, ins: false }
  let buf = ''

  const flush = () => {
    if (buf) spans.push({ text: buf, style: { ...style } })
    buf = ''
  }

  for (let i = 0; i < line.length;) {
    if (line.startsWith('^^', i)) {
      flush()
      style.keyword = !style.keyword
      i += 2
    } else if (line.startsWith('<ins>', i)) {
      flush()
      style.ins = true
      i += 5
    } else if (line.startsWith('</ins>', i)) {
      flush()
      style.ins = false
      i += 6
    } else if (line[i] === '*') {
      let n = 0
      while (line[i + n] === '*') n++
      flush()
      i += n
      // A run is bold (**) and/or italic (*). When a run closes bold and leaves one spare star, that
      // star is a malformed closer (`^^**x^^***`) — drop it rather than open a stray italic span.
      let closedBold = false
      while (n > 0) {
        if (n >= 2) {
          closedBold ||= style.bold
          style.bold = !style.bold
          n -= 2
        } else {
          if (style.italic) style.italic = false
          else if (!closedBold) style.italic = true
          n -= 1
        }
      }
    } else {
      buf += line[i]
      i++
    }
  }
  flush()

  const nodes: InlineNode[] = []
  const push = (node: InlineNode) => {
    const last = nodes[nodes.length - 1]
    if (last && last.type === 'text' && node.type === 'text') last.text += node.text
    else nodes.push(node)
  }

  spans.forEach((span, idx) => {
    const { text, style: s } = span
    if (!text) return
    if (s.ins) return push({ type: 'or', text })
    if (s.keyword) return push({ type: 'keyword', text })
    if (s.bold) {
      const atLineStart = nodes.every(n => n.type === 'text' && !n.text.trim())
      const next = spans[idx + 1]
      if (atLineStart && next && !next.style.bold && LABEL_FOLLOWER.test(next.text)) {
        return push({ type: 'label', text })
      }
      // `**Example:**` carries its own colon; a bold ALL-CAPS term is a unit keyword (DEDICATED TRANSPORT).
      if (atLineStart && /:\s*$/.test(text)) return push({ type: 'label', text })
      return push(isAllCaps(text) ? { type: 'keyword', text } : { type: 'term', text })
    }
    if (s.italic) return push({ type: 'em', text })
    push({ type: 'text', text })
  })

  return nodes
}

const BULLET = /^(\s*)(?:[-▪•])\s+(.*)$/
const NUMBERED = /^(\s*)\d+\.\s+(.*)$/

/** Parse `effect` markup into display blocks. */
export function parseRichText(src: string): Block[] {
  const blocks: Block[] = []
  // nbsp (from the source's indentation) counts as whitespace for list-depth detection
  const lines = src.replace(/\r/g, '').replace(/ /g, ' ').split('\n')

  let list: { ordered: boolean; items: ListItem[] } | null = null
  const closeList = () => {
    if (list) blocks.push({ type: 'list', ...list })
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { closeList(); continue }

    const numbered = NUMBERED.exec(line)
    const bullet = numbered ? null : BULLET.exec(line)
    if (numbered || bullet) {
      const m = (numbered ?? bullet)!
      const nested = m[1].length > 0
      const item: ListItem = { content: parseInline(m[2]), children: [] }
      const ordered = !!numbered && !nested
      if (list && nested && list.items.length > 0) {
        list.items[list.items.length - 1].children.push(item)
      } else {
        if (list && list.ordered !== ordered) closeList()
        list ??= { ordered, items: [] }
        list.items.push(item)
      }
      continue
    }

    closeList()
    const content = parseInline(line.trim())
    if (content.length === 0) continue
    const first = content[0]
    const isExample = first.type === 'label' && /^example\b/i.test(first.text)
    blocks.push({ type: isExample ? 'example' : 'paragraph', content })
  }
  closeList()
  return blocks
}

/** Plain-text rendering (markers removed, lists flattened) for one-line previews. */
export function stripRichText(src: string): string {
  const inline = (nodes: InlineNode[]) => nodes.map(n => n.text).join('')
  const item = (i: ListItem): string[] => [inline(i.content), ...i.children.flatMap(item)]
  return parseRichText(src)
    .flatMap(b => (b.type === 'list' ? b.items.flatMap(item) : [inline(b.content)]))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
