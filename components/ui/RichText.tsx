import { Fragment, useMemo } from 'react'
import { parseRichText, type Block, type InlineNode, type ListItem } from '@/lib/richText'
import styles from './RichText.module.css'

interface Props {
  /** Raw `effect` text carrying `^^keyword^^` / `**term**` / list markup. */
  text: string
  /** Applied to the wrapper so call sites can keep their own font-size / colour. */
  className?: string
}

const INLINE_CLASS: Record<Exclude<InlineNode['type'], 'text'>, string> = {
  keyword: styles.keyword,
  term: styles.term,
  label: styles.label,
  em: styles.em,
  or: styles.or,
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === 'text'
          ? <Fragment key={i}>{n.text}</Fragment>
          : <span key={i} className={INLINE_CLASS[n.type]}>{n.text}</span>,
      )}
    </>
  )
}

function Items({ items }: { items: ListItem[] }) {
  return (
    <>
      {items.map((item, i) => (
        <li key={i} className={styles.item}>
          <Inline nodes={item.content} />
          {item.children.length > 0 && (
            <ul className={styles.list}><Items items={item.children} /></ul>
          )}
        </li>
      ))}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return <Tag className={block.ordered ? styles.ordered : styles.list}><Items items={block.items} /></Tag>
    }
    case 'example':
      return <p className={styles.example}><Inline nodes={block.content} /></p>
    default:
      return <p className={styles.paragraph}><Inline nodes={block.content} /></p>
  }
}

/** Renders rule text with its source markup interpreted (see `lib/richText.ts`). */
export function RichText({ text, className }: Props) {
  const blocks = useMemo(() => parseRichText(text), [text])
  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  )
}
