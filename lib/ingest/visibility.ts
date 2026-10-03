import type { Condition, Modifier } from '../parsers/bsdata'

/**
 * Static evaluation of BSData `hidden` modifiers on the nodes a unit walk passes through.
 *
 * BattleScribe hides many abilities unless something about the roster holds: a detachment is
 * selected (Gloam Rot only with Shadow Legion, Necron detachment rules linked onto every unit),
 * the primary catalogue is a particular faction (Templar Vows only for Black Templars), or the
 * force is (not) Boarding Actions / Crusade. The unit walk used to ignore all of this, so every
 * conditional ability leaked onto every unit that linked it.
 *
 * At ingest time we know the primary catalogue and assume a standard matched-play force, so
 * those conditions resolve statically. The selected detachment is not known until a roster is
 * loaded, so detachment conditions are resolved *symbolically* — by evaluating once with no
 * detachment and once per faction detachment — and the result travels on the artifact as an
 * {@link AbilityGate} for `buildRoster` to apply. Conditions we cannot evaluate here (wargear /
 * unit-local scopes: `self`, `parent`, `ancestor`, `model-or-unit`, …) are resolved toward
 * visible, so they never hide anything — the walk's previous behaviour.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BsNode = Record<string, any>

export interface VisibilityContext {
  /** The faction's own (primary) catalogue id. */
  primaryCatalogueId: string
  /** Detachment entry ids legal for this faction — the ones a roster can select. */
  factionDetachmentIds: string[]
  /** Every detachment entry id anywhere in the import chain (incl. other factions'). */
  allDetachmentIds: Set<string>
  /** Every forceEntry id (Boarding Actions, Crusade Force, …). Assumed never to be the force. */
  forceEntryIds: Set<string>
}

/**
 * Detachment visibility of an ability. Absent (`undefined`) means always visible.
 *  - `detachments`: visible only when one of these detachment ids is selected.
 *  - `exceptDetachments`: visible unless one of these detachment ids is selected.
 */
export type AbilityGate = { detachments: string[] } | { exceptDetachments: string[] }

export type Visibility = { kind: 'always' } | { kind: 'never' } | { kind: 'gated'; gate: AbilityGate }

const ALWAYS: Visibility = { kind: 'always' }
const NEVER: Visibility = { kind: 'never' }

/** True when the node carries anything that can affect its visibility. */
export function hasVisibilityRules(node: BsNode | undefined): boolean {
  if (!node) return false
  if (node.hidden === 'true') return true
  return (node.modifiers?.modifier ?? []).some((m: Modifier) => m.field === 'hidden')
}

function compare(count: number, type: string, value: number): boolean | undefined {
  switch (type) {
    case 'lessThan': return count < value
    case 'greaterThan': return count > value
    case 'equalTo': return count === value
    case 'notEqualTo': return count !== value
    case 'atLeast': return count >= value
    case 'atMost': return count <= value
    default: return undefined
  }
}

/**
 * Evaluate one condition. Returns `undefined` when it can't be decided at ingest (wargear /
 * unit-local conditions); see {@link isHidden} for how that is resolved.
 */
function evalCondition(c: Condition, ctx: VisibilityContext, selected: Set<string>): boolean | undefined {
  const id = c.childId
  if (!id) return undefined
  const isInstance = c.type === 'instanceOf' || c.type === 'notInstanceOf'
  const negate = c.type === 'notInstanceOf'

  if (c.scope === 'primary-catalogue' && isInstance) {
    const is = id === ctx.primaryCatalogueId
    return negate ? !is : is
  }

  if (ctx.allDetachmentIds.has(id)) {
    // A unit is never nested inside a detachment selection, and the force itself is never a
    // detachment, so instanceOf on a detachment id is statically false.
    if (isInstance) return negate
    // Selection counts. Detachments outside this faction can never be selected.
    const owned = ctx.factionDetachmentIds.includes(id)
    return compare(owned && selected.has(id) ? 1 : 0, c.type, Number(c.value ?? 0))
  }

  if (ctx.forceEntryIds.has(id)) {
    // Assume a standard matched-play force: never Boarding Actions / Crusade.
    if (isInstance) return negate
    return compare(0, c.type, Number(c.value ?? 0))
  }

  return undefined
}

/**
 * Evaluate a condition group with three-valued (Kleene) logic: `undefined` = undecidable here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evalGroup(group: any, ctx: VisibilityContext, selected: Set<string>): boolean | undefined {
  const results: (boolean | undefined)[] = [
    ...(group.conditions?.condition ?? []).map((c: Condition) => evalCondition(c, ctx, selected)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(group.conditionGroups?.conditionGroup ?? []).map((g: any) => evalGroup(g, ctx, selected)),
  ]
  if (group.type === 'or') {
    if (results.length === 0 || results.some((r) => r === true)) return true
    return results.every((r) => r === false) ? false : undefined
  }
  if (results.some((r) => r === false)) return false
  return results.every((r) => r === true) ? true : undefined
}

/**
 * Whether a single node is hidden for the given selected-detachment set. A modifier whose
 * conditions can't be decided here (wargear / unit-local) is resolved toward *visible*: a
 * hiding modifier doesn't fire, an un-hiding one does (e.g. the Crucible daemons' default-hidden
 * "Khorne" option, revealed when its wargear is taken) — so undecidable gates never hide.
 */
function isHidden(node: BsNode, ctx: VisibilityContext, selected: Set<string>): boolean {
  let hidden = node.hidden === 'true'
  for (const mod of (node.modifiers?.modifier ?? []) as Modifier[]) {
    if (mod.field !== 'hidden' || mod.type !== 'set') continue
    // A modifier's top-level conditions and condition groups are ANDed together.
    const holds = evalGroup({ type: 'and', conditions: mod.conditions, conditionGroups: mod.conditionGroups }, ctx, selected)
    const hides = mod.value === 'true'
    if (holds === true || (holds === undefined && !hides)) hidden = hides
  }
  return hidden
}

/**
 * Visibility of an ability reached through `nodes` (every gating node on the path: enclosing
 * entries/links, the link to the ability and the ability's definition). The ability is hidden
 * when any of them is hidden.
 */
export function evaluateVisibility(nodes: BsNode[], ctx: VisibilityContext): Visibility {
  const gating = nodes.filter(hasVisibilityRules)
  if (gating.length === 0) return ALWAYS
  const visibleWith = (selected: Set<string>) => !gating.some((n) => isHidden(n, ctx, selected))

  const withNone = visibleWith(new Set())
  const perDetachment = ctx.factionDetachmentIds.map((id) => ({ id, visible: visibleWith(new Set([id])) }))
  const shown = perDetachment.filter((d) => d.visible).map((d) => d.id)
  const hiddenBy = perDetachment.filter((d) => !d.visible).map((d) => d.id)

  if (withNone) return hiddenBy.length === 0 ? ALWAYS : { kind: 'gated', gate: { exceptDetachments: hiddenBy } }
  return shown.length === 0 ? NEVER : { kind: 'gated', gate: { detachments: shown } }
}

/**
 * Combine the gates of one ability reached via two paths: it is visible whenever either path
 * makes it visible. `undefined` = always visible.
 */
export function unionGates(a: AbilityGate | undefined, b: AbilityGate | undefined): AbilityGate | undefined {
  if (!a || !b) return undefined
  if ('detachments' in a && 'detachments' in b) {
    return { detachments: [...new Set([...a.detachments, ...b.detachments])] }
  }
  if ('exceptDetachments' in a && 'exceptDetachments' in b) {
    const ids = a.exceptDetachments.filter((id) => b.exceptDetachments.includes(id))
    return ids.length ? { exceptDetachments: ids } : undefined
  }
  // Mixed: visible with no detachment (via the except path) and with any listed one.
  const only = 'detachments' in a ? a : (b as { detachments: string[] })
  const except = 'exceptDetachments' in a ? a : (b as { exceptDetachments: string[] })
  const ids = except.exceptDetachments.filter((id) => !only.detachments.includes(id))
  return ids.length ? { exceptDetachments: ids } : undefined
}

/** Collect every forceEntry id (recursively nested) from the game system + catalogues. */
export function collectForceEntryIds(roots: BsNode[]): Set<string> {
  const ids = new Set<string>()
  const stack: BsNode[] = roots.flatMap((r) => r.forceEntries?.forceEntry ?? [])
  while (stack.length) {
    const fe = stack.pop()!
    if (typeof fe?.id === 'string') ids.add(fe.id)
    stack.push(...(fe?.forceEntries?.forceEntry ?? []))
  }
  return ids
}
