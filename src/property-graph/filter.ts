// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Pure predicate engine and view visibility for property-graph canvases.
// No Obsidian imports, no eval, and no mutation of caller-supplied data.
//
// Semantics summary:
// - Predicates are evaluated in three-valued logic. A property condition on an element whose
//   property lookup returned null (malformed YAML) is UNKNOWN; UNKNOWN never makes an element
//   visible, also not through None groups.
// - Missing (no own key) is distinct from null, false, 0, "" and empty lists/maps. Only `exists`
//   and `missing` match on presence; every other operator requires a present value.
// - Path segments: a string is one literal own key (so "a.b" is a single key); a number is a
//   non-negative array index. Inherited properties and accessors are never read.
// - Ordered operators compare finite numbers with numbers, or ISO date strings of the same kind:
//   calendar dates (YYYY-MM-DD) with dates, zoned date-times (…T…Z / ±HH:MM) with date-times.
import type {
  Condition,
  FilterGroup,
  FilterOperator,
  GraphData,
  GraphEdge,
  GraphElement,
  GraphNode,
  Predicate,
  PropertyLookup,
  PropertyValue,
  SavedView,
  Visibility,
} from './types'

const OPERATORS: readonly FilterOperator[] = ['exists', 'missing', 'equals', 'not-equals', 'contains', 'text-contains', 'gt', 'gte', 'lt', 'lte']
const GROUP_KINDS = ['all', 'any', 'none'] as const
const SCOPES = ['properties', 'native'] as const
const VIEW_MODES = ['nodes', 'edges'] as const
const RESERVED_NATIVE_ROOT = 'propertyGraph'
/** Maximum nesting depth of predicates and literal values; also bounds cyclic input. */
export const MAX_DEPTH = 64

// ---------------------------------------------------------------------------------------------
// Shared helpers

const MISSING: unique symbol = Symbol('missing')
type Resolved = unknown

function fail(location: string, message: string): never {
  throw new TypeError(`${location}: ${message}`)
}

function hasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key) as boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** Reads an own data property; inherited keys and accessors count as missing. */
function ownValue(target: object, key: string | number): Resolved {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor || !('value' in descriptor)) return MISSING
  return descriptor.value === undefined ? MISSING : descriptor.value
}

function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  // defineProperty keeps keys such as "__proto__" as ordinary own data.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return typeof value
}

// ---------------------------------------------------------------------------------------------
// ISO dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/

interface IsoKey { kind: 'date' | 'instant'; key: number }

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** Parses an explicit ISO 8601 date or zoned date-time; returns null for anything else. */
export function parseIsoDate(text: string): IsoKey | null {
  if (text.length < 10 || text.length > 40) return null

  const date = ISO_DATE.exec(text)
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
    if (!validCalendarDate(year, month, day)) return null
    return { kind: 'date', key: year * 10000 + month * 100 + day }
  }

  const dateTime = ISO_DATE_TIME.exec(text)
  if (!dateTime) return null
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map(i => Number(dateTime[i]))
  const second = dateTime[6] === undefined ? 0 : Number(dateTime[6])
  const millisecond = dateTime[7] === undefined ? 0 : Number(dateTime[7].padEnd(3, '0').slice(0, 3))
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null

  let offsetMinutes = 0
  const zone = dateTime[8]
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3))
    const offsetMins = Number(zone.slice(4, 6))
    if (offsetHours > 23 || offsetMins > 59) return null
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMins)
  }

  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day) // setUTCFullYear avoids Date.UTC's 0–99 → 1900s mapping
  utc.setUTCHours(hour, minute, second, millisecond)
  return { kind: 'instant', key: utc.getTime() - offsetMinutes * 60_000 }
}

// ---------------------------------------------------------------------------------------------
// Validation

function cloneLiteral(value: unknown, location: string, depth: number): PropertyValue {
  if (depth > MAX_DEPTH) fail(location, `literal nesting exceeds ${MAX_DEPTH} levels (cyclic value?)`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(location, `numbers must be finite, got ${String(value)}`)
    return value
  }
  if (Array.isArray(value)) {
    const result: PropertyValue[] = []
    for (let i = 0; i < value.length; i++) {
      if (!hasOwn(value, i)) fail(`${location}[${i}]`, 'sparse lists are not allowed')
      result.push(cloneLiteral(value[i], `${location}[${i}]`, depth + 1))
    }
    return result
  }
  if (isPlainObject(value)) {
    const result: Record<string, PropertyValue> = {}
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in descriptor)) fail(`${location}.${JSON.stringify(key)}`, 'accessor properties are not allowed')
      defineOwn(result, key, cloneLiteral(descriptor.value, `${location}[${JSON.stringify(key)}]`, depth + 1))
    }
    return result
  }
  return fail(location, `expected string, finite number, boolean, null, list or plain map, got ${describe(value)}`)
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${location}.${key}`, `unknown field; allowed fields are ${allowed.join(', ')}`)
}

function readField(value: Record<string, unknown>, key: string): unknown {
  const read = ownValue(value, key)
  return read === MISSING ? undefined : read
}

function validateCondition(value: Record<string, unknown>, location: string): Condition {
  checkKeys(value, ['kind', 'scope', 'path', 'operator', 'value'], location)

  const scope = readField(value, 'scope')
  if (!SCOPES.includes(scope as typeof SCOPES[number]))
    fail(`${location}.scope`, `expected "properties" or "native", got ${JSON.stringify(scope) ?? 'undefined'}`)

  const rawPath = readField(value, 'path')
  if (!Array.isArray(rawPath) || rawPath.length === 0)
    fail(`${location}.path`, 'expected a non-empty list of key strings and list indexes')
  if (rawPath.length > MAX_DEPTH) fail(`${location}.path`, `paths may have at most ${MAX_DEPTH} segments`)
  const path: (string | number)[] = []
  for (let i = 0; i < rawPath.length; i++) {
    const segment: unknown = rawPath[i]
    if (typeof segment === 'string') path.push(segment)
    else if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) path.push(segment)
    else fail(`${location}.path[${i}]`, `expected a literal key string or a non-negative integer list index, got ${JSON.stringify(segment) ?? describe(segment)}`)
  }
  if (scope === 'native') {
    if (typeof path[0] !== 'string') fail(`${location}.path[0]`, 'native paths must start with a field name')
    if (path[0] === RESERVED_NATIVE_ROOT)
      fail(`${location}.path[0]`, `"${RESERVED_NATIVE_ROOT}" is not a native field; use scope "properties" to filter element properties`)
  }

  const operator = readField(value, 'operator') as FilterOperator
  if (!OPERATORS.includes(operator))
    fail(`${location}.operator`, `expected one of ${OPERATORS.join(', ')}, got ${JSON.stringify(operator) ?? 'undefined'}`)

  const hasValue = hasOwn(value, 'value')
  const rawValue = readField(value, 'value')
  const condition: Condition = { kind: 'condition', scope: scope as Condition['scope'], path, operator }

  switch (operator) {
    case 'exists':
    case 'missing':
      if (hasValue) fail(`${location}.value`, `operator "${operator}" takes no value; remove the value field`)
      break
    case 'equals':
    case 'not-equals':
    case 'contains':
      if (!hasValue || rawValue === undefined) fail(`${location}.value`, `operator "${operator}" requires a value (use null to match null)`)
      condition.value = cloneLiteral(rawValue, `${location}.value`, 0)
      break
    case 'text-contains':
      if (typeof rawValue !== 'string') fail(`${location}.value`, `operator "text-contains" requires a string value, got ${describe(rawValue)}`)
      condition.value = rawValue
      break
    default: // gt, gte, lt, lte
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) condition.value = rawValue
      else if (typeof rawValue === 'string' && parseIsoDate(rawValue) !== null) condition.value = rawValue
      else fail(`${location}.value`, `operator "${operator}" requires a finite number or an ISO date (YYYY-MM-DD) / zoned date-time (YYYY-MM-DDTHH:MM[:SS[.sss]] with Z or ±HH:MM), got ${JSON.stringify(rawValue) ?? describe(rawValue)}`)
  }

  return condition
}

function validatePredicate(value: unknown, location: string, depth: number): Predicate {
  if (depth > MAX_DEPTH) fail(location, `predicate nesting exceeds ${MAX_DEPTH} levels (cyclic predicate?)`)
  if (!isPlainObject(value)) fail(location, `expected a predicate object, got ${describe(value)}`)

  const kind = readField(value, 'kind')
  if (kind === 'condition') return validateCondition(value, location)
  if (!GROUP_KINDS.includes(kind as typeof GROUP_KINDS[number]))
    fail(`${location}.kind`, `expected "condition", "all", "any" or "none", got ${JSON.stringify(kind) ?? 'undefined'}`)

  checkKeys(value, ['kind', 'conditions'], location)
  const conditions = readField(value, 'conditions')
  if (!Array.isArray(conditions)) fail(`${location}.conditions`, 'expected a list of predicates')

  const group: FilterGroup = { kind: kind as FilterGroup['kind'], conditions: [] }
  for (let i = 0; i < conditions.length; i++)
    group.conditions.push(validatePredicate(conditions[i], `${location}.conditions[${i}]`, depth + 1))
  return group
}

/** Validates an untrusted saved view and returns an independent normalized copy. */
export function validateView(value: unknown): SavedView {
  const location = 'view'
  if (!isPlainObject(value)) fail(location, `expected a view object, got ${describe(value)}`)
  checkKeys(value, ['id', 'name', 'mode', 'nodes', 'edges'], location)

  const id = readField(value, 'id')
  if (typeof id !== 'string' || id.length === 0) fail(`${location}.id`, 'expected a non-empty string')
  const name = readField(value, 'name')
  if (typeof name !== 'string' || name.trim().length === 0) fail(`${location}.name`, 'expected a non-blank string')
  const mode = readField(value, 'mode')
  if (!VIEW_MODES.includes(mode as typeof VIEW_MODES[number]))
    fail(`${location}.mode`, `expected "nodes" or "edges", got ${JSON.stringify(mode) ?? 'undefined'}`)

  const view: SavedView = { id, name, mode: mode as SavedView['mode'] }
  const nodes = readField(value, 'nodes')
  if (nodes !== undefined) view.nodes = validatePredicate(nodes, `${location}.nodes`, 0)
  const edges = readField(value, 'edges')
  if (edges !== undefined) view.edges = validatePredicate(edges, `${location}.edges`, 0)
  return view
}

// ---------------------------------------------------------------------------------------------
// Compilation (three-valued: TRUE, FALSE, UNKNOWN)

const FALSE = 0, TRUE = 1, UNKNOWN = 2
type Truth = typeof FALSE | typeof TRUE | typeof UNKNOWN

interface EvaluationContext {
  element: GraphElement
  lookup: PropertyLookup
  loaded: boolean
  properties: object | null
}

type CompiledPredicate = (context: EvaluationContext) => Truth

function resolvePath(root: unknown, path: readonly (string | number)[]): Resolved {
  let current = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return MISSING
    } else if (typeof current !== 'object' || current === null || Array.isArray(current)) return MISSING
    current = ownValue(current, segment)
    if (current === MISSING) return MISSING
  }
  return current
}

/** Strict structural equality; `expected` is a validated literal, so recursion is bounded by it. */
function deepEqual(actual: unknown, expected: PropertyValue): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false
    for (let i = 0; i < expected.length; i++) {
      const item = ownValue(actual, i)
      if (item === MISSING || !deepEqual(item, expected[i])) return false
    }
    return true
  }
  if (!isPlainObject(actual)) return false
  const expectedKeys = Object.keys(expected)
  if (Object.keys(actual).length !== expectedKeys.length) return false
  for (const key of expectedKeys) {
    const item = ownValue(actual, key)
    if (item === MISSING || !deepEqual(item, expected[key])) return false
  }
  return true
}

function compileTest(condition: Condition): (value: Resolved) => boolean {
  const expected = condition.value as PropertyValue
  switch (condition.operator) {
    case 'exists': return value => value !== MISSING
    case 'missing': return value => value === MISSING
    case 'equals': return value => value !== MISSING && deepEqual(value, expected)
    case 'not-equals': return value => value !== MISSING && !deepEqual(value, expected)
    case 'contains': return value => Array.isArray(value) && value.some((_item, i) => {
      const item = ownValue(value, i)
      return item !== MISSING && deepEqual(item, expected)
    })
    case 'text-contains': return value => typeof value === 'string' && value.includes(expected as string)
  }

  const compare: (difference: number) => boolean =
    condition.operator === 'gt' ? d => d > 0 :
    condition.operator === 'gte' ? d => d >= 0 :
    condition.operator === 'lt' ? d => d < 0 :
    d => d <= 0

  if (typeof expected === 'number')
    return value => typeof value === 'number' && Number.isFinite(value) && compare(value - expected)

  const expectedDate = parseIsoDate(expected as string)!
  return value => {
    if (typeof value !== 'string') return false
    const actualDate = parseIsoDate(value)
    return actualDate !== null && actualDate.kind === expectedDate.kind && compare(actualDate.key - expectedDate.key)
  }
}

function compileCondition(condition: Condition): CompiledPredicate {
  const test = compileTest(condition)
  const path = condition.path

  if (condition.scope === 'native')
    return context => test(resolvePath(context.element, path)) ? TRUE : FALSE

  return context => {
    if (!context.loaded) {
      const properties: unknown = context.lookup(context.element)
      context.properties = typeof properties === 'object' && properties !== null && !Array.isArray(properties) ? properties : null
      context.loaded = true
    }
    if (context.properties === null) return UNKNOWN
    return test(resolvePath(context.properties, path)) ? TRUE : FALSE
  }
}

function compileValidated(predicate: Predicate): CompiledPredicate {
  if (predicate.kind === 'condition') return compileCondition(predicate)

  const children = predicate.conditions.map(compileValidated)
  const any: CompiledPredicate = context => {
    let result: Truth = FALSE
    for (const child of children) {
      const value = child(context)
      if (value === TRUE) return TRUE
      if (value === UNKNOWN) result = UNKNOWN
    }
    return result
  }

  if (predicate.kind === 'any') return any
  if (predicate.kind === 'none') return context => {
    const value = any(context)
    return value === TRUE ? FALSE : value === FALSE ? TRUE : UNKNOWN
  }
  return context => {
    let result: Truth = TRUE
    for (const child of children) {
      const value = child(context)
      if (value === FALSE) return FALSE
      if (value === UNKNOWN) result = UNKNOWN
    }
    return result
  }
}

type ElementTest = (element: GraphElement, lookup: PropertyLookup) => boolean

function toElementTest(predicate: Predicate | undefined): ElementTest {
  if (predicate === undefined) return () => true
  const compiled = compileValidated(predicate)
  return (element, lookup) => compiled({ element, lookup, loaded: false, properties: null }) === TRUE
}

/**
 * Compiles a predicate. An absent predicate matches every element. The lookup is called at most
 * once per evaluation and only when a property condition is reached.
 */
export function compilePredicate(predicate?: Predicate): ElementTest {
  if (predicate === undefined) return () => true
  return toElementTest(validatePredicate(predicate, 'predicate', 0))
}

// ---------------------------------------------------------------------------------------------
// Whole-graph evaluation

function elementId(element: unknown, location: string): string {
  if (typeof element !== 'object' || element === null) fail(location, `expected an element object, got ${describe(element)}`)
  const id = ownValue(element, 'id')
  if (typeof id !== 'string') fail(`${location}.id`, 'expected a string element id')
  return id
}

function edgeEndpoints(edge: unknown, location: string): [string, string] {
  const from = ownValue(edge as object, 'fromNode')
  const to = ownValue(edge as object, 'toNode')
  if (typeof from !== 'string') fail(`${location}.fromNode`, 'expected a string node id')
  if (typeof to !== 'string') fail(`${location}.toNode`, 'expected a string node id')
  return [from, to]
}

function checkGraph(data: GraphData): void {
  if (typeof data !== 'object' || data === null) fail('data', `expected graph data, got ${describe(data)}`)
  if (!Array.isArray(data.nodes)) fail('data.nodes', 'expected a list of nodes')
  if (!Array.isArray(data.edges)) fail('data.edges', 'expected a list of edges')
}

/**
 * Computes visible node and edge IDs without mutating `data`. An undefined view is All and
 * includes every record, including edges whose endpoints are absent. Filtered views never show
 * an edge unless both endpoint nodes are present and visible.
 */
export function evaluateView(data: GraphData, view: SavedView | undefined, lookup: PropertyLookup): Visibility {
  checkGraph(data)
  const nodes = new Set<string>()
  const edges = new Set<string>()

  if (view === undefined) {
    data.nodes.forEach((node, i) => nodes.add(elementId(node, `data.nodes[${i}]`)))
    data.edges.forEach((edge, i) => {
      edges.add(elementId(edge, `data.edges[${i}]`))
      edgeEndpoints(edge, `data.edges[${i}]`)
    })
    return { nodes, edges }
  }

  const validView = validateView(view)
  const nodeTest = toElementTest(validView.nodes)
  const edgeTest = toElementTest(validView.edges)

  if (validView.mode === 'nodes') {
    data.nodes.forEach((node, i) => {
      const id = elementId(node, `data.nodes[${i}]`)
      if (nodeTest(node, lookup)) nodes.add(id)
    })
    data.edges.forEach((edge, i) => {
      const id = elementId(edge, `data.edges[${i}]`)
      const [from, to] = edgeEndpoints(edge, `data.edges[${i}]`)
      if (nodes.has(from) && nodes.has(to) && edgeTest(edge, lookup)) edges.add(id)
    })
    return { nodes, edges }
  }

  const allowed = new Set<string>()
  data.nodes.forEach((node, i) => {
    const id = elementId(node, `data.nodes[${i}]`)
    if (nodeTest(node, lookup)) allowed.add(id)
  })
  data.edges.forEach((edge, i) => {
    const id = elementId(edge, `data.edges[${i}]`)
    const [from, to] = edgeEndpoints(edge, `data.edges[${i}]`)
    if (allowed.has(from) && allowed.has(to) && edgeTest(edge, lookup)) {
      edges.add(id)
      nodes.add(from)
      nodes.add(to)
    }
  })
  return { nodes, edges }
}

// ---------------------------------------------------------------------------------------------
// Incremental index

export interface VisibilityDelta {
  shownNodes: string[]
  hiddenNodes: string[]
  shownEdges: string[]
  hiddenEdges: string[]
}

interface EdgeRecord { edge: GraphEdge; from: string; to: string; match: boolean }

interface Transaction { nodes: Map<string, boolean>; edges: Map<string, boolean> }

/**
 * Maintains visibility for one view under element upserts/removals. Element IDs are assumed
 * unique per kind (true for live Canvas maps); with duplicate IDs the last upsert wins, whereas
 * evaluateView shows an ID if any record with it matches. Stores element references, not copies;
 * call upsert again after an element or its properties change.
 */
export class ViewIndex {
  private view: SavedView | undefined
  private nodeTest: ElementTest = () => true
  private edgeTest: ElementTest = () => true
  private readonly nodes = new Map<string, { node: GraphNode; allowed: boolean }>()
  private readonly edges = new Map<string, EdgeRecord>()
  private readonly incident = new Map<string, Set<string>>()
  private readonly visibleNodes = new Set<string>()
  /** Visible edges with the record whose endpoints were counted (edge mode reference counts). */
  private readonly visibleEdges = new Map<string, EdgeRecord>()
  private readonly endpointCounts = new Map<string, number>()

  constructor(view: SavedView | undefined, private readonly lookup: PropertyLookup) {
    this.configure(view)
  }

  /** Replaces all records and recomputes visibility. */
  load(data: GraphData): void {
    checkGraph(data)
    this.nodes.clear(); this.edges.clear(); this.incident.clear()

    data.nodes.forEach((node, i) => {
      const id = elementId(node, `data.nodes[${i}]`)
      this.nodes.set(id, { node, allowed: this.nodeTest(node, this.lookup) })
    })
    data.edges.forEach((edge, i) => this.storeEdge(edge, `data.edges[${i}]`))
    this.recomputeVisibility()
  }

  /** Switches the view, re-evaluating stored elements; returns the visibility change. */
  setView(view: SavedView | undefined): VisibilityDelta {
    const nodesBefore = new Set(this.visibleNodes)
    const edgesBefore = new Set(this.visibleEdges.keys())

    // Element maps and incidence do not depend on the view; only matches are re-evaluated.
    this.configure(view)
    for (const record of this.nodes.values()) record.allowed = this.nodeTest(record.node, this.lookup)
    for (const record of this.edges.values()) record.match = this.edgeTest(record.edge, this.lookup)
    this.recomputeVisibility()

    // Avoid push(...set): spreading 10^5 arguments overflows the call stack.
    const shownNodes: string[] = [], shownEdges: string[] = []
    for (const id of this.visibleNodes) if (!nodesBefore.delete(id)) shownNodes.push(id)
    for (const id of this.visibleEdges.keys()) if (!edgesBefore.delete(id)) shownEdges.push(id)
    return { shownNodes, hiddenNodes: Array.from(nodesBefore), shownEdges, hiddenEdges: Array.from(edgesBefore) }
  }

  upsertNode(node: GraphNode): VisibilityDelta {
    const id = elementId(node, 'node')
    const transaction = this.begin()
    this.nodes.set(id, { node, allowed: this.nodeTest(node, this.lookup) })
    return this.propagateNode(transaction, id)
  }

  removeNode(id: string): VisibilityDelta {
    const transaction = this.begin()
    this.nodes.delete(id)
    return this.propagateNode(transaction, id)
  }

  upsertEdge(edge: GraphEdge): VisibilityDelta {
    const transaction = this.begin()
    const id = this.storeEdge(edge, 'edge')
    this.refreshEdge(transaction, id)
    return this.settle(transaction)
  }

  removeEdge(id: string): VisibilityDelta {
    const transaction = this.begin()
    const record = this.edges.get(id)
    if (record) {
      this.edges.delete(id)
      this.unlinkIncident(id, record)
    }
    this.refreshEdge(transaction, id)
    return this.settle(transaction)
  }

  isNodeVisible(id: string): boolean { return this.visibleNodes.has(id) }
  isEdgeVisible(id: string): boolean { return this.visibleEdges.has(id) }

  /** Returns an independent snapshot of the current visibility. */
  visibility(): Visibility {
    return { nodes: new Set(this.visibleNodes), edges: new Set(this.visibleEdges.keys()) }
  }

  // --- internals ---

  /** Bulk path without transaction bookkeeping; callers needing a delta diff snapshots. */
  private recomputeVisibility(): void {
    this.visibleNodes.clear(); this.visibleEdges.clear(); this.endpointCounts.clear()
    if (this.mode() !== 'edges') for (const id of this.nodes.keys()) this.refreshNode(null, id)
    for (const id of this.edges.keys()) this.refreshEdge(null, id)
    if (this.mode() === 'edges') for (const id of this.endpointCounts.keys()) this.refreshNode(null, id)
  }

  private configure(view: SavedView | undefined): void {
    this.view = view === undefined ? undefined : validateView(view)
    this.nodeTest = toElementTest(this.view?.nodes)
    this.edgeTest = toElementTest(this.view?.edges)
  }

  private mode(): 'all' | 'nodes' | 'edges' { return this.view?.mode ?? 'all' }

  private storeEdge(edge: GraphEdge, location: string): string {
    const id = elementId(edge, location)
    const [from, to] = edgeEndpoints(edge, location)
    const previous = this.edges.get(id)
    if (previous) this.unlinkIncident(id, previous)
    this.edges.set(id, { edge, from, to, match: this.edgeTest(edge, this.lookup) })
    this.linkIncident(from, id)
    if (to !== from) this.linkIncident(to, id)
    return id
  }

  private linkIncident(nodeId: string, edgeId: string): void {
    let set = this.incident.get(nodeId)
    if (!set) this.incident.set(nodeId, set = new Set())
    set.add(edgeId)
  }

  private unlinkIncident(id: string, record: EdgeRecord): void {
    for (const nodeId of record.from === record.to ? [record.from] : [record.from, record.to]) {
      const set = this.incident.get(nodeId)
      set?.delete(id)
      if (set?.size === 0) this.incident.delete(nodeId)
    }
  }

  private propagateNode(transaction: Transaction, id: string): VisibilityDelta {
    if (this.mode() !== 'edges') this.refreshNode(transaction, id)
    for (const edgeId of this.incident.get(id) ?? []) this.refreshEdge(transaction, edgeId)
    return this.settle(transaction)
  }

  /** In edge mode, node visibility follows the endpoint counts changed by edge refreshes. */
  private settle(transaction: Transaction): VisibilityDelta {
    if (this.mode() === 'edges') for (const id of transaction.nodes.keys()) this.refreshNode(transaction, id)
    return this.finish(transaction)
  }

  private wantsEdge(record: EdgeRecord | undefined): boolean {
    if (!record) return false
    const mode = this.mode()
    if (mode === 'all') return true
    if (!record.match) return false
    if (mode === 'nodes') return this.visibleNodes.has(record.from) && this.visibleNodes.has(record.to)
    return this.nodes.get(record.from)?.allowed === true && this.nodes.get(record.to)?.allowed === true
  }

  private refreshNode(transaction: Transaction | null, id: string): void {
    this.touchNode(transaction, id)
    const mode = this.mode()
    const record = this.nodes.get(id)
    const visible =
      mode === 'all' ? record !== undefined :
      mode === 'nodes' ? record?.allowed === true :
      (this.endpointCounts.get(id) ?? 0) > 0
    if (visible) this.visibleNodes.add(id)
    else this.visibleNodes.delete(id)
  }

  private refreshEdge(transaction: Transaction | null, id: string): void {
    this.touchEdge(transaction, id)
    const record = this.edges.get(id)
    const want = this.wantsEdge(record)
    const counted = this.visibleEdges.get(id)

    if (counted && (!want || counted.from !== record!.from || counted.to !== record!.to)) {
      this.visibleEdges.delete(id)
      this.adjustEndpoints(transaction, counted, -1)
    }
    if (want && !this.visibleEdges.has(id)) {
      this.visibleEdges.set(id, record!)
      this.adjustEndpoints(transaction, record!, 1)
    }
  }

  private adjustEndpoints(transaction: Transaction | null, { from, to }: EdgeRecord, change: 1 | -1): void {
    if (this.mode() !== 'edges') return
    this.adjustCount(transaction, from, change)
    if (to !== from) this.adjustCount(transaction, to, change)
  }

  private adjustCount(transaction: Transaction | null, nodeId: string, change: 1 | -1): void {
    const count = (this.endpointCounts.get(nodeId) ?? 0) + change
    if (count > 0) this.endpointCounts.set(nodeId, count)
    else this.endpointCounts.delete(nodeId)
    this.touchNode(transaction, nodeId)
  }

  private begin(): Transaction { return { nodes: new Map(), edges: new Map() } }

  private touchNode(transaction: Transaction | null, id: string): void {
    if (transaction && !transaction.nodes.has(id)) transaction.nodes.set(id, this.visibleNodes.has(id))
  }

  private touchEdge(transaction: Transaction | null, id: string): void {
    if (transaction && !transaction.edges.has(id)) transaction.edges.set(id, this.visibleEdges.has(id))
  }

  private finish(transaction: Transaction): VisibilityDelta {
    const delta: VisibilityDelta = { shownNodes: [], hiddenNodes: [], shownEdges: [], hiddenEdges: [] }
    for (const [id, before] of transaction.nodes) {
      const after = this.visibleNodes.has(id)
      if (after && !before) delta.shownNodes.push(id)
      else if (!after && before) delta.hiddenNodes.push(id)
    }
    for (const [id, before] of transaction.edges) {
      const after = this.visibleEdges.has(id)
      if (after && !before) delta.shownEdges.push(id)
      else if (!after && before) delta.hiddenEdges.push(id)
    }
    return delta
  }
}
