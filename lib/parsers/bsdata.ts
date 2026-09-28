import { XMLParser } from 'fast-xml-parser'

/**
 * Thin typed wrapper over BSData (BattleScribe) `.cat` / `.gst` XML.
 * Parse only — no cross-reference resolution or normalization here.
 *
 * BSData wraps every repeatable element in a plural container, e.g.
 * `<profiles><profile/></profiles>`, so the typed shapes below mirror that.
 */

const ARRAY_ELEMENTS = new Set([
  'catalogueLink',
  'selectionEntry',
  'selectionEntryGroup',
  'entryLink',
  'infoLink',
  'categoryLink',
  'categoryEntry',
  'profile',
  'characteristic',
  'cost',
  'costType',
  'constraint',
  'modifier',
  'condition',
  'conditionGroup',
  'repeat',
  'rule',
  'infoGroup',
  'profileType',
  'characteristicType',
  'forceEntry',
  'publication',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
})

export interface Characteristic {
  name: string
  typeId: string
  '#text'?: string
}

export interface Profile {
  id: string
  name: string
  typeId: string
  typeName: string
  hidden?: string
  characteristics?: { characteristic?: Characteristic[] }
}

export interface InfoLink {
  id: string
  name: string
  type: string
  targetId: string
  hidden?: string
  modifiers?: { modifier?: Modifier[] }
}

export interface CategoryLink {
  id: string
  name: string
  targetId: string
  primary?: string
}

export interface Cost {
  name: string
  typeId: string
  value: string
}

export interface RuleNode {
  id: string
  name: string
  hidden?: string
  description?: string | { '#text'?: string }
}

export interface EntryLink {
  id: string
  name: string
  type: string
  targetId: string
  hidden?: string
  profiles?: { profile?: Profile[] }
  infoLinks?: { infoLink?: InfoLink[] }
  costs?: { cost?: Cost[] }
}

export interface SelectionEntryGroup {
  id: string
  name: string
  hidden?: string
  selectionEntries?: { selectionEntry?: SelectionEntry[] }
  selectionEntryGroups?: { selectionEntryGroup?: SelectionEntryGroup[] }
  entryLinks?: { entryLink?: EntryLink[] }
}

/**
 * A BattleScribe modifier condition. The detachment-scoping logic cares about
 * `type="notInstanceOf"` with `scope="primary-catalogue"`, whose `childId` is the
 * catalogue id a (chapter-)specific detachment is restricted to.
 */
export interface Condition {
  type: string
  scope?: string
  field?: string
  childId?: string
  value?: string
}

/** A BattleScribe modifier. Detachments use `field="hidden"` to gate visibility per catalogue. */
export interface Modifier {
  type: string
  field: string
  value: string
  conditions?: { condition?: Condition[] }
  conditionGroups?: { conditionGroup?: { type?: string; conditions?: { condition?: Condition[] } }[] }
}

export interface SelectionEntry {
  id: string
  name: string
  type: string
  hidden?: string
  import?: string
  /** Free-text annotation. 11e uses it on enhancement entries to name the owning detachment. */
  comment?: string
  profiles?: { profile?: Profile[] }
  rules?: { rule?: RuleNode[] }
  infoLinks?: { infoLink?: InfoLink[] }
  entryLinks?: { entryLink?: EntryLink[] }
  selectionEntries?: { selectionEntry?: SelectionEntry[] }
  selectionEntryGroups?: { selectionEntryGroup?: SelectionEntryGroup[] }
  categoryLinks?: { categoryLink?: CategoryLink[] }
  costs?: { cost?: Cost[] }
  modifiers?: { modifier?: Modifier[] }
}

export interface CatalogueLink {
  id: string
  name: string
  type: string
  targetId: string
  importRootEntries?: string
}

export interface CategoryEntry {
  id: string
  name: string
  hidden?: string
}

export interface Catalogue {
  id: string
  name: string
  library?: string
  gameSystemId: string
  revision: string
  catalogueLinks?: { catalogueLink?: CatalogueLink[] }
  sharedSelectionEntries?: { selectionEntry?: SelectionEntry[] }
  sharedSelectionEntryGroups?: { selectionEntryGroup?: SelectionEntryGroup[] }
  sharedProfiles?: { profile?: Profile[] }
  sharedRules?: { rule?: RuleNode[] }
  selectionEntries?: { selectionEntry?: SelectionEntry[] }
  entryLinks?: { entryLink?: EntryLink[] }
  categoryEntries?: { categoryEntry?: CategoryEntry[] }
}

/** A profile-type definition (`<profileType>`). The GST defines the structural ones
 *  (Unit, Ranged/Melee Weapons, Abilities, Transport); catalogues define themed ones. */
export interface ProfileType {
  id: string
  name: string
}

export interface GameSystem {
  id: string
  name: string
  revision: string
  profileTypes?: { profileType?: ProfileType[] }
  sharedRules?: { rule?: RuleNode[] }
  sharedProfiles?: { profile?: Profile[] }
  categoryEntries?: { categoryEntry?: CategoryEntry[] }
}

export interface BsRoot {
  catalogue?: Catalogue
  gameSystem?: GameSystem
}

export function parseBsXml(xml: string): BsRoot {
  return parser.parse(xml) as BsRoot
}

export function parseCatalogue(xml: string): Catalogue {
  const root = parseBsXml(xml)
  if (!root.catalogue) throw new Error('Expected a <catalogue> root element.')
  return root.catalogue
}

export function parseGameSystem(xml: string): GameSystem {
  const root = parseBsXml(xml)
  if (!root.gameSystem) throw new Error('Expected a <gameSystem> root element.')
  return root.gameSystem
}

/** Read the text of a node that may be a bare string or a `{ '#text' }` object. */
export function textOf(value: string | { '#text'?: string } | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return value['#text'] ?? ''
}
