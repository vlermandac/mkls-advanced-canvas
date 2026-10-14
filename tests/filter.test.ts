// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
// Behavioral tests for the pure property-graph filter engine (node:test, no Obsidian).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compilePredicate, evaluateView, parseIsoDate, validateView, ViewIndex, VisibilityDelta } from '../src/property-graph/filter'
import type { Condition, GraphData, GraphEdge, GraphElement, GraphNode, Predicate, PropertyLookup, PropertyMap, PropertyValue, SavedView, Visibility } from '../src/property-graph/types'

// --- fixtures -------------------------------------------------------------------------------

/** Test lookup: property YAML written as JSON (a YAML subset); unparsable text is malformed. */
const jsonLookup: PropertyLookup = element => {
  if (!element.propertyGraph) return {}
  try {
    const parsed: unknown = JSON.parse(element.propertyGraph.yaml)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as PropertyMap : null
  } catch { return null }
}

function withProps(properties: PropertyMap | string): { version: 1; yaml: string } {
  return { version: 1, yaml: typeof properties === 'string' ? properties : JSON.stringify(properties) }
}

function node(id: string, properties?: PropertyMap | string, extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'text', ...extra, ...(properties === undefined ? {} : { propertyGraph: withProps(properties) }) }
}

function edge(id: string, fromNode: string, toNode: string, properties?: PropertyMap | string, extra: Record<string, unknown> = {}): GraphEdge {
  return { id, fromNode, toNode, ...extra, ...(properties === undefined ? {} : { propertyGraph: withProps(properties) }) }
}

function prop(path: (string | number)[], operator: Condition['operator'], value?: PropertyValue): Condition {
  return { kind: 'condition', scope: 'properties', path, operator, ...(value === undefined ? {} : { value }) }
}

function native(path: (string | number)[], operator: Condition['operator'], value?: PropertyValue): Condition {
  return { kind: 'condition', scope: 'native', path, operator, ...(value === undefined ? {} : { value }) }
}

const all = (...conditions: Predicate[]): Predicate => ({ kind: 'all', conditions })
const any = (...conditions: Predicate[]): Predicate => ({ kind: 'any', conditions })
const none = (...conditions: Predicate[]): Predicate => ({ kind: 'none', conditions })

function matches(predicate: Predicate, element: GraphElement, lookup: PropertyLookup = jsonLookup): boolean {
  return compilePredicate(predicate)(element, lookup)
}

function sorted(visibility: Visibility): { nodes: string[]; edges: string[] } {
  return { nodes: [...visibility.nodes].sort(), edges: [...visibility.edges].sort() }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

/** Deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- validation -----------------------------------------------------------------------------

describe('validateView', () => {
  const valid = { id: 'v1', name: 'Topics', mode: 'nodes', nodes: prop(['topic'], 'equals', 'algebra') }

  it('returns an independent normalized copy', () => {
    const input = JSON.parse(JSON.stringify(valid)) as SavedView
    const view = validateView(input)
    assert.deepEqual(view, valid)
    ;(input.nodes as Condition).value = 'changed'
    assert.equal((view.nodes as Condition).value, 'algebra')
  })

  it('accepts views without predicates', () => {
    assert.deepEqual(validateView({ id: 'v', name: 'Edges', mode: 'edges' }), { id: 'v', name: 'Edges', mode: 'edges' })
  })

  const rejects: [string, unknown, RegExp][] = [
    ['non-object', 'view', /^view: expected a view object, got string/],
    ['empty id', { ...valid, id: '' }, /^view\.id: /],
    ['blank name', { ...valid, name: '  ' }, /^view\.name: /],
    ['bad mode', { ...valid, mode: 'graph' }, /^view\.mode: expected "nodes" or "edges"/],
    ['unknown view field', { ...valid, color: 'red' }, /^view\.color: unknown field/],
    ['unknown operator', { ...valid, nodes: all(prop(['a'], 'exists'), { ...prop(['a'], 'exists'), operator: 'matches' } as unknown as Condition) }, /^view\.nodes\.conditions\[1\]\.operator: expected one of/],
    ['bad group kind', { ...valid, nodes: { kind: 'xor', conditions: [] } }, /^view\.nodes\.kind: /],
    ['group without list', { ...valid, nodes: { kind: 'all' } }, /^view\.nodes\.conditions: expected a list/],
    ['bad scope', { ...valid, nodes: { ...prop(['a'], 'exists'), scope: 'note' } }, /^view\.nodes\.scope: /],
    ['empty path', { ...valid, nodes: prop([], 'exists') }, /^view\.nodes\.path: expected a non-empty list/],
    ['negative index', { ...valid, nodes: prop(['a', -1], 'exists') }, /^view\.nodes\.path\[1\]: /],
    ['fractional index', { ...valid, nodes: prop(['a', 1.5], 'exists') }, /^view\.nodes\.path\[1\]: /],
    ['native index root', { ...valid, nodes: native([0], 'exists') }, /^view\.nodes\.path\[0\]: native paths must start/],
    ['native propertyGraph', { ...valid, nodes: native(['propertyGraph', 'yaml'], 'exists') }, /^view\.nodes\.path\[0\]: "propertyGraph" is not a native field/],
    ['exists with value', { ...valid, nodes: { ...prop(['a'], 'exists'), value: 1 } }, /^view\.nodes\.value: operator "exists" takes no value/],
    ['equals without value', { ...valid, nodes: prop(['a'], 'equals') }, /^view\.nodes\.value: operator "equals" requires a value/],
    ['NaN literal', { ...valid, nodes: prop(['a'], 'equals', NaN) }, /^view\.nodes\.value: numbers must be finite/],
    ['nested Infinity', { ...valid, nodes: prop(['a'], 'equals', { b: [Infinity] }) }, /^view\.nodes\.value\["b"\]\[0\]: numbers must be finite/],
    ['text-contains number', { ...valid, nodes: prop(['a'], 'text-contains', 1) }, /requires a string value/],
    ['ordered plain string', { ...valid, nodes: prop(['a'], 'gt', 'tomorrow') }, /requires a finite number or an ISO date/],
    ['ordered local date-time', { ...valid, nodes: prop(['a'], 'gt', '2024-01-01T10:00') }, /requires a finite number or an ISO date/],
    ['ordered impossible date', { ...valid, nodes: prop(['a'], 'lt', '2023-02-29') }, /requires a finite number or an ISO date/],
    ['Date object literal', { ...valid, nodes: prop(['a'], 'equals', new Date(0) as unknown as PropertyValue) }, /expected string, finite number/],
  ]
  for (const [name, input, pattern] of rejects)
    it(`rejects ${name} with a located TypeError`, () => assert.throws(() => validateView(input), (error: unknown) => error instanceof TypeError && pattern.test(error.message)))

  it('rejects cyclic predicates and literals without overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { kind: 'all', conditions: [] }
    ;(cyclic.conditions as unknown[]).push(cyclic)
    assert.throws(() => validateView({ ...valid, nodes: cyclic }), /nesting exceeds 64 levels/)

    const literal: Record<string, unknown> = {}
    literal.self = literal
    assert.throws(() => validateView({ ...valid, nodes: prop(['a'], 'equals', literal as PropertyMap) }), /nesting exceeds 64 levels/)
  })

  it('rejects accessor literals without invoking them', () => {
    let invoked = false
    const literal = Object.defineProperty({}, 'a', { enumerable: true, get: () => { invoked = true; return 1 } }) as PropertyMap
    assert.throws(() => validateView({ ...valid, nodes: prop(['x'], 'equals', literal) }), /accessor properties are not allowed/)
    assert.equal(invoked, false)
  })

  it('keeps "__proto__" literal keys as own data without polluting prototypes', () => {
    const literal = JSON.parse('{"__proto__": {"polluted": true}}') as PropertyMap
    const view = validateView({ ...valid, nodes: prop(['x'], 'equals', literal) })
    const copied = (view.nodes as Condition).value as PropertyMap
    assert.ok(Object.prototype.hasOwnProperty.call(copied, '__proto__'))
    assert.equal(Object.getPrototypeOf(copied), Object.prototype)
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  it('compilePredicate validates and treats undefined as match-all', () => {
    assert.equal(compilePredicate()(node('a', 'not json'), jsonLookup), true)
    assert.throws(() => compilePredicate({ kind: 'condition' } as unknown as Predicate), TypeError)
  })
})

// --- operators ------------------------------------------------------------------------------

describe('presence and strict equality', () => {
  const element = node('n', { nil: null, no: false, zero: 0, empty: '', list: [], map: {}, one: 1, text: '1' })
  const keys = ['nil', 'no', 'zero', 'empty', 'list', 'map']

  it('distinguishes missing from null, false, zero and empty values', () => {
    for (const key of keys) {
      assert.equal(matches(prop([key], 'exists'), element), true, key)
      assert.equal(matches(prop([key], 'missing'), element), false, key)
    }
    assert.equal(matches(prop(['absent'], 'exists'), element), false)
    assert.equal(matches(prop(['absent'], 'missing'), element), true)
  })

  it('compares values of different types as unequal', () => {
    const literals: PropertyValue[] = [null, false, 0, '', [], {}]
    keys.forEach((key, i) => literals.forEach((literal, j) =>
      assert.equal(matches(prop([key], 'equals', literal), element), i === j, `${key} equals ${JSON.stringify(literal)}`)))
    assert.equal(matches(prop(['one'], 'equals', '1'), element), false)
    assert.equal(matches(prop(['text'], 'equals', 1), element), false)
  })

  it('does not match not-equals on missing fields', () => {
    assert.equal(matches(prop(['absent'], 'not-equals', 'x'), element), false)
    assert.equal(matches(prop(['nil'], 'not-equals', 'x'), element), true)
    assert.equal(matches(prop(['nil'], 'not-equals', null), element), false)
    assert.equal(matches(none(prop(['absent'], 'equals', 'x')), element), true, 'None is the explicit way to include missing')
  })

  it('compares lists by order and maps by key set', () => {
    const e = node('n', { list: [1, [2, { a: 3 }]], map: { a: 1, b: { c: [true] } } })
    assert.equal(matches(prop(['list'], 'equals', [1, [2, { a: 3 }]]), e), true)
    assert.equal(matches(prop(['list'], 'equals', [[2, { a: 3 }], 1]), e), false)
    assert.equal(matches(prop(['map'], 'equals', { b: { c: [true] }, a: 1 }), e), true)
    assert.equal(matches(prop(['map'], 'equals', { a: 1 }), e), false)
    assert.equal(matches(prop(['map'], 'equals', { a: 1, b: { c: [true] }, d: null }), e), false)
  })
})

describe('paths and safe lookup', () => {
  const element = node('n', { a: { b: 1 }, 'a.b': 2, list: ['x', { y: 'z' }], obj: { 0: 'zero' }, '': 'blank' })

  it('treats strings as literal keys and numbers as list indexes', () => {
    assert.equal(matches(prop(['a', 'b'], 'equals', 1), element), true)
    assert.equal(matches(prop(['a.b'], 'equals', 2), element), true)
    assert.equal(matches(prop(['list', 1, 'y'], 'equals', 'z'), element), true)
    assert.equal(matches(prop(['list', '1'], 'exists'), element), false, 'string segment does not index a list')
    assert.equal(matches(prop(['obj', 0], 'exists'), element), false, 'number segment does not read a map')
    assert.equal(matches(prop(['obj', '0'], 'equals', 'zero'), element), true)
    assert.equal(matches(prop(['list', 5], 'missing'), element), true)
    assert.equal(matches(prop(['a', 'b', 'c'], 'missing'), element), true, 'descending into a scalar is missing')
    assert.equal(matches(prop([''], 'equals', 'blank'), element), true)
  })

  it('never reads inherited or prototype-looking keys that are not own data', () => {
    const plain = node('n', {})
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])
      assert.equal(matches(prop([key], 'missing'), plain), true, key)
    assert.equal(matches(prop(['list', 'length'], 'missing'), element), true)

    const inherited = Object.create({ topic: 'inherited' }) as PropertyMap
    assert.equal(matches(prop(['topic'], 'missing'), plain, () => inherited), true)
    assert.equal(matches(native(['toString'], 'missing'), plain), true)
  })

  it('reads an own "__proto__" key as ordinary data', () => {
    const element = node('n', '{"__proto__": {"x": 1}}')
    assert.equal(matches(prop(['__proto__', 'x'], 'equals', 1), element), true)
    assert.equal(matches(prop(['__proto__'], 'equals', { x: 1 }), element), true)
  })

  it('does not invoke accessors on property maps', () => {
    let invoked = false
    const map = Object.defineProperty({}, 'topic', { enumerable: true, get: () => { invoked = true; return 'x' } }) as PropertyMap
    assert.equal(matches(prop(['topic'], 'exists'), node('n'), () => map), false)
    assert.equal(invoked, false)
  })

  it('reads native and unknown native fields from the element only', () => {
    const element = node('n', { color: 'red' }, { color: '4', styleAttributes: { shape: 'pill' }, custom: [1, 2] })
    assert.equal(matches(native(['color'], 'equals', '4'), element), true)
    assert.equal(matches(prop(['color'], 'equals', 'red'), element), true)
    assert.equal(matches(native(['styleAttributes', 'shape'], 'equals', 'pill'), element), true)
    assert.equal(matches(native(['custom'], 'contains', 2), element), true)
    assert.equal(matches(native(['type'], 'equals', 'text'), element), true)
    assert.equal(matches(prop(['type'], 'missing'), element), true, 'native type is not a property')
  })
})

describe('containment and ordering', () => {
  const element = node('n', {
    tags: ['algebra', { kind: 'proof' }, 3], title: 'Rank–nullity theorem', n: 5, numeric: '5',
    day: '2024-02-29', at: '2024-02-29T12:00:00+02:00', local: '2024-02-29T12:00', bad: '2023-02-29',
  })

  it('list contains uses strict structural equality', () => {
    assert.equal(matches(prop(['tags'], 'contains', 'algebra'), element), true)
    assert.equal(matches(prop(['tags'], 'contains', { kind: 'proof' }), element), true)
    assert.equal(matches(prop(['tags'], 'contains', '3'), element), false)
    assert.equal(matches(prop(['title'], 'contains', 'Rank'), element), false, 'contains is for lists only')
  })

  it('text-contains is case-sensitive and applies to strings only', () => {
    assert.equal(matches(prop(['title'], 'text-contains', 'nullity'), element), true)
    assert.equal(matches(prop(['title'], 'text-contains', 'RANK'), element), false)
    assert.equal(matches(prop(['tags'], 'text-contains', 'algebra'), element), false)
    assert.equal(matches(prop(['n'], 'text-contains', '5'), element), false)
  })

  it('orders finite numbers only against numbers', () => {
    assert.equal(matches(prop(['n'], 'gt', 4), element), true)
    assert.equal(matches(prop(['n'], 'gte', 5), element), true)
    assert.equal(matches(prop(['n'], 'lt', 5), element), false)
    assert.equal(matches(prop(['numeric'], 'gt', 4), element), false, 'numeric strings are not coerced')
    assert.equal(matches(prop(['day'], 'gt', 4), element), false)
  })

  it('orders explicit ISO dates and zoned date-times of the same kind', () => {
    assert.equal(matches(prop(['day'], 'gt', '2024-02-28'), element), true)
    assert.equal(matches(prop(['day'], 'lte', '2024-02-29'), element), true)
    assert.equal(matches(prop(['at'], 'equals', '2024-02-29T10:00:00Z'), element), false, 'equals stays textual')
    assert.equal(matches(prop(['at'], 'gte', '2024-02-29T10:00:00Z'), element), true, 'same instant across offsets')
    assert.equal(matches(prop(['at'], 'gt', '2024-02-29T10:00:00Z'), element), false)
    assert.equal(matches(prop(['at'], 'gt', '2024-02-28'), element), false, 'date-time does not compare with a calendar date')
    assert.equal(matches(prop(['local'], 'lt', '2030-01-01T00:00Z'), element), false, 'zone-less date-times are not comparable')
    assert.equal(matches(prop(['bad'], 'lt', '2030-01-01'), element), false, 'impossible calendar dates are not comparable')
    assert.equal(matches(prop(['n'], 'lt', '2030-01-01'), element), false)
  })

  it('parses ISO edge cases exactly', () => {
    assert.deepEqual(parseIsoDate('0001-01-01'), { kind: 'date', key: 10101 })
    assert.equal(parseIsoDate('0050-06-01T00:00Z')!.key, Date.parse('0050-06-01T00:00:00.000Z'))
    assert.equal(parseIsoDate('2024-01-01T00:00:00.123456Z')!.key, Date.parse('2024-01-01T00:00:00.123Z'))
    for (const text of ['2024-13-01', '2024-1-01', '2024-01-01T24:00Z', '2024-01-01T10:00+24:00', '2024-01-01 10:00Z', ' 2024-01-01'])
      assert.equal(parseIsoDate(text), null, text)
  })
})

describe('groups and malformed properties', () => {
  const ok = node('ok', { topic: 'algebra', level: 3 })
  const malformed = node('bad', '{ not json')

  it('evaluates nested All/Any/None groups', () => {
    const predicate = all(prop(['topic'], 'equals', 'algebra'), any(prop(['level'], 'gt', 5), none(prop(['level'], 'equals', 4))))
    assert.equal(matches(predicate, ok), true)
    assert.equal(matches(predicate, node('x', { topic: 'algebra', level: 4 })), false)
    assert.equal(matches(all(), ok), true)
    assert.equal(matches(any(), ok), false)
    assert.equal(matches(none(), ok), true)
  })

  it('fails every property predicate on malformed YAML, including through None', () => {
    for (const predicate of [prop(['topic'], 'missing'), prop(['topic'], 'exists'), none(prop(['topic'], 'equals', 'x')), none(none(prop(['topic'], 'exists'))), all(native(['type'], 'equals', 'text'), prop(['a'], 'missing'))])
      assert.equal(matches(predicate, malformed), false, JSON.stringify(predicate))
  })

  it('still evaluates native conditions and decisive branches on malformed YAML', () => {
    assert.equal(matches(native(['type'], 'equals', 'text'), malformed), true)
    assert.equal(matches(any(native(['type'], 'equals', 'text'), prop(['a'], 'exists')), malformed), true)
    assert.equal(matches(all(native(['type'], 'equals', 'file'), prop(['a'], 'exists')), malformed), false)
    assert.equal(matches(none(native(['type'], 'equals', 'file'), prop(['a'], 'exists')), malformed), false)
  })

  it('looks up properties lazily and at most once per evaluation', () => {
    let calls = 0
    const counting: PropertyLookup = element => { calls++; return jsonLookup(element) }
    compilePredicate(native(['type'], 'equals', 'text'))(ok, counting)
    assert.equal(calls, 0)
    compilePredicate(all(prop(['topic'], 'exists'), prop(['level'], 'gt', 1), none(prop(['x'], 'exists'))))(ok, counting)
    assert.equal(calls, 1)
  })

  it('treats predicate text as data, never code', () => {
    const element = node('n', { code: 'globalThis.__evaluated = true' })
    assert.equal(matches(prop(['code'], 'text-contains', 'globalThis'), element), true)
    assert.equal((globalThis as Record<string, unknown>).__evaluated, undefined)
  })
})

// --- views ----------------------------------------------------------------------------------

describe('evaluateView', () => {
  const graph: GraphData = {
    nodes: [
      node('a', { keep: true }), node('b', { keep: true }), node('c', { keep: false }),
      node('isolated', { keep: true }), node('broken', '{'), node('loop', { keep: true }),
    ],
    edges: [
      edge('ab1', 'a', 'b', { role: 'uses' }), edge('ab2', 'a', 'b', { role: 'cites' }), edge('ba', 'b', 'a', { role: 'uses' }),
      edge('ac', 'a', 'c', { role: 'uses' }), edge('a-broken', 'a', 'broken', { role: 'uses' }),
      edge('self', 'loop', 'loop', { role: 'uses' }), edge('dangling', 'a', 'ghost', { role: 'uses' }), edge('bad-edge', 'a', 'b', '['),
    ],
  }
  const keep = prop(['keep'], 'equals', true)
  const uses = prop(['role'], 'equals', 'uses')

  it('shows every record, including malformed and dangling ones, for the All view', () => {
    const result = sorted(evaluateView(graph, undefined, jsonLookup))
    assert.deepEqual(result.nodes, graph.nodes.map(n => n.id).sort())
    assert.deepEqual(result.edges, graph.edges.map(e => e.id).sort())
  })

  it('node mode shows matching nodes, including isolated ones, and edges with both endpoints visible', () => {
    const result = sorted(evaluateView(graph, { id: 'v', name: 'Kept', mode: 'nodes', nodes: keep, edges: uses }, jsonLookup))
    assert.deepEqual(result.nodes, ['a', 'b', 'isolated', 'loop'])
    assert.deepEqual(result.edges, ['ab1', 'ba', 'self'], 'parallel edges are independent; malformed edge fails its predicate')
  })

  it('node mode without an edge predicate shows every edge between visible nodes', () => {
    const result = sorted(evaluateView(graph, { id: 'v', name: 'Kept', mode: 'nodes', nodes: keep }, jsonLookup))
    assert.deepEqual(result.edges, ['ab1', 'ab2', 'ba', 'bad-edge', 'self'])
  })

  it('edge mode shows matching edges with their endpoints and excludes isolated nodes', () => {
    const result = sorted(evaluateView(graph, { id: 'v', name: 'Uses', mode: 'edges', edges: uses }, jsonLookup))
    assert.deepEqual(result.edges, ['a-broken', 'ab1', 'ac', 'ba', 'self'])
    assert.deepEqual(result.nodes, ['a', 'b', 'broken', 'c', 'loop'])
  })

  it('edge mode never lets endpoint inclusion override an explicit node predicate', () => {
    const result = sorted(evaluateView(graph, { id: 'v', name: 'Uses', mode: 'edges', nodes: keep, edges: uses }, jsonLookup))
    assert.deepEqual(result.edges, ['ab1', 'ba', 'self'])
    assert.deepEqual(result.nodes, ['a', 'b', 'loop'])
  })

  it('does not mutate frozen input data', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(graph)) as GraphData)
    const before = JSON.stringify(frozen)
    evaluateView(frozen, { id: 'v', name: 'Kept', mode: 'edges', nodes: keep, edges: uses }, jsonLookup)
    assert.equal(JSON.stringify(frozen), before)
  })

  it('rejects malformed graph records with located TypeErrors', () => {
    assert.throws(() => evaluateView({ nodes: [{ type: 'text' } as unknown as GraphNode], edges: [] }, undefined, jsonLookup), /^TypeError: data\.nodes\[0\]\.id: /)
    assert.throws(() => evaluateView({ nodes: [], edges: [{ id: 'e', fromNode: 'a' } as unknown as GraphEdge] }, undefined, jsonLookup), /^TypeError: data\.edges\[0\]\.toNode: /)
  })
})

// --- incremental index ----------------------------------------------------------------------

describe('ViewIndex', () => {
  const views: (SavedView | undefined)[] = [
    undefined,
    { id: 'n', name: 'Nodes', mode: 'nodes', nodes: prop(['k'], 'lt', 3), edges: prop(['r'], 'equals', 1) },
    { id: 'e', name: 'Edges', mode: 'edges', nodes: none(prop(['k'], 'equals', 0)), edges: prop(['r'], 'gte', 1) },
    { id: 'e2', name: 'Edges only', mode: 'edges', edges: prop(['r'], 'equals', 2) },
  ]

  function randomGraph(next: () => number, size: number): GraphData {
    const value = (): PropertyMap | string => next() < 0.05 ? '{' : { k: Math.floor(next() * 5) }
    const nodes = Array.from({ length: size }, (_, i) => node(`n${i}`, value()))
    const edges = Array.from({ length: size * 2 }, (_, i) => {
      const props = next() < 0.05 ? '{' : { r: Math.floor(next() * 3) }
      return edge(`e${i}`, `n${Math.floor(next() * (size + 2))}`, `n${Math.floor(next() * size)}`, props)
    })
    return { nodes, edges }
  }

  function applyDelta(previous: Visibility, delta: VisibilityDelta): Visibility {
    const nodes = new Set(previous.nodes), edges = new Set(previous.edges)
    for (const id of delta.shownNodes) { assert.ok(!nodes.has(id), `shown node ${id} was visible`); nodes.add(id) }
    for (const id of delta.hiddenNodes) { assert.ok(nodes.delete(id), `hidden node ${id} was not visible`) }
    for (const id of delta.shownEdges) { assert.ok(!edges.has(id), `shown edge ${id} was visible`); edges.add(id) }
    for (const id of delta.hiddenEdges) { assert.ok(edges.delete(id), `hidden edge ${id} was not visible`) }
    return { nodes, edges }
  }

  for (const view of views) {
    it(`matches evaluateView through random mutations (${view?.id ?? 'all'})`, () => {
      const next = random(42)
      const size = 40
      const data = randomGraph(next, size)
      const index = new ViewIndex(view, jsonLookup)
      index.load(data)
      let expected = index.visibility()
      assert.deepEqual(sorted(expected), sorted(evaluateView(data, view, jsonLookup)))

      for (let step = 0; step < 400; step++) {
        const roll = next()
        let delta: VisibilityDelta
        if (roll < 0.35 && data.nodes.length > 0) {
          const i = Math.floor(next() * data.nodes.length)
          data.nodes[i] = node(data.nodes[i].id, next() < 0.1 ? '{' : { k: Math.floor(next() * 5) })
          delta = index.upsertNode(data.nodes[i])
        } else if (roll < 0.45 && data.nodes.length > 0) {
          const [removed] = data.nodes.splice(Math.floor(next() * data.nodes.length), 1)
          delta = index.removeNode(removed.id)
        } else if (roll < 0.55) {
          const id = `n${Math.floor(next() * size)}`
          if (data.nodes.some(n => n.id === id)) continue
          const added = node(id, { k: Math.floor(next() * 5) })
          data.nodes.push(added)
          delta = index.upsertNode(added)
        } else if (roll < 0.85) {
          const i = Math.floor(next() * data.edges.length)
          const old = data.edges[i]
          const rewire = next() < 0.3
          data.edges[i] = edge(old.id, rewire ? `n${Math.floor(next() * size)}` : old.fromNode, rewire ? `n${Math.floor(next() * size)}` : old.toNode, { r: Math.floor(next() * 3) })
          delta = index.upsertEdge(data.edges[i])
        } else {
          const [removed] = data.edges.splice(Math.floor(next() * data.edges.length), 1)
          delta = index.removeEdge(removed.id)
        }
        expected = applyDelta(expected, delta)
        assert.deepEqual(sorted(expected), sorted(evaluateView(data, view, jsonLookup)), `step ${step}`)
        assert.deepEqual(sorted(index.visibility()), sorted(expected), `step ${step}`)
      }
    })
  }

  it('reports exact deltas when switching views', () => {
    const data = randomGraph(random(7), 30)
    const index = new ViewIndex(undefined, jsonLookup)
    index.load(data)
    let current = index.visibility()
    for (const view of [...views.slice(1), undefined, views[2]]) {
      current = applyDelta(current, index.setView(view))
      assert.deepEqual(sorted(current), sorted(evaluateView(data, view, jsonLookup)))
    }
  })

  it('keeps self loops visible until their only edge disappears in edge mode', () => {
    const index = new ViewIndex(views[3], jsonLookup)
    index.load({ nodes: [node('a', {})], edges: [edge('s1', 'a', 'a', { r: 2 }), edge('s2', 'a', 'a', { r: 2 })] })
    assert.equal(index.isNodeVisible('a'), true)
    assert.deepEqual(index.removeEdge('s1'), { shownNodes: [], hiddenNodes: [], shownEdges: [], hiddenEdges: ['s1'] })
    assert.deepEqual(index.upsertEdge(edge('s2', 'a', 'a', { r: 0 })), { shownNodes: [], hiddenNodes: ['a'], shownEdges: [], hiddenEdges: ['s2'] })
  })
})
