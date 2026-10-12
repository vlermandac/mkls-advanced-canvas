// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Deterministic benchmark for the pure filter engine. It measures predicate evaluation over
// pre-parsed property maps (a warm property cache), not YAML parsing, DOM work or Obsidian.
// Usage (after bundling with esbuild): node filter-benchmark.mjs [nodeCounts…]
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { evaluateView, ViewIndex } from '../src/property-graph/filter'
import type { GraphData, GraphEdge, GraphElement, GraphNode, PropertyLookup, PropertyMap, SavedView } from '../src/property-graph/types'

const TOPICS = Array.from({ length: 20 }, (_, i) => `topic-${i}`)
const ROLES = ['uses', 'proves', 'generalizes', 'cites', 'contradicts']
const MALFORMED_RATE = 0.01
const EDGES_PER_NODE = 3

function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isoDay(next: () => number): string {
  const day = new Date(Date.UTC(2020, 0, 1) + Math.floor(next() * 365 * 5) * 86_400_000)
  return day.toISOString().slice(0, 10)
}

/** Five property keys per element; 1% of elements carry malformed YAML. */
function generate(nodeCount: number, seed: number): { data: GraphData; properties: Map<GraphElement, PropertyMap | null> } {
  const next = random(seed)
  const properties = new Map<GraphElement, PropertyMap | null>()
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]

  const nodes: GraphNode[] = []
  for (let i = 0; i < nodeCount; i++) {
    const map: PropertyMap = {
      topic: pick(TOPICS),
      level: 1 + Math.floor(next() * 10),
      reviewed: next() < 0.5,
      tags: [pick(TOPICS), pick(TOPICS)],
      updated: isoDay(next),
    }
    const malformed = next() < MALFORMED_RATE
    const element: GraphNode = { id: `n${i}`, type: 'text', x: i * 10, y: 0, width: 250, height: 60, text: `Node ${i}`, propertyGraph: { version: 1, yaml: malformed ? '{' : JSON.stringify(map) } }
    nodes.push(element)
    properties.set(element, malformed ? null : map)
  }

  const edges: GraphEdge[] = []
  for (let i = 0; i < nodeCount * EDGES_PER_NODE; i++) {
    const map: PropertyMap = {
      role: pick(ROLES),
      weight: Math.round(next() * 100) / 100,
      directed: next() < 0.8,
      sources: [pick(TOPICS)],
      added: isoDay(next),
    }
    const malformed = next() < MALFORMED_RATE
    const element: GraphEdge = { id: `e${i}`, fromNode: `n${Math.floor(next() * nodeCount)}`, toNode: `n${Math.floor(next() * nodeCount)}`, propertyGraph: { version: 1, yaml: malformed ? '{' : JSON.stringify(map) } }
    edges.push(element)
    properties.set(element, malformed ? null : map)
  }
  return { data: { nodes, edges }, properties }
}

const VIEWS: Record<string, SavedView | undefined> = {
  all: undefined,
  'node-equals': { id: 'v1', name: 'One topic', mode: 'nodes', nodes: { kind: 'condition', scope: 'properties', path: ['topic'], operator: 'equals', value: 'topic-3' } },
  'node-nested': {
    id: 'v2', name: 'Nested', mode: 'nodes',
    nodes: { kind: 'all', conditions: [
      { kind: 'condition', scope: 'properties', path: ['level'], operator: 'gte', value: 4 },
      { kind: 'any', conditions: [
        { kind: 'condition', scope: 'properties', path: ['tags'], operator: 'contains', value: 'topic-1' },
        { kind: 'condition', scope: 'properties', path: ['updated'], operator: 'gt', value: '2023-06-30' },
      ] },
      { kind: 'none', conditions: [{ kind: 'condition', scope: 'properties', path: ['reviewed'], operator: 'equals', value: false }] },
    ] },
    edges: { kind: 'condition', scope: 'properties', path: ['weight'], operator: 'gt', value: 0.25 },
  },
  'edge-constrained': {
    id: 'v3', name: 'Proofs', mode: 'edges',
    nodes: { kind: 'condition', scope: 'properties', path: ['level'], operator: 'lte', value: 7 },
    edges: { kind: 'all', conditions: [
      { kind: 'condition', scope: 'properties', path: ['role'], operator: 'equals', value: 'proves' },
      { kind: 'condition', scope: 'native', path: ['fromNode'], operator: 'exists' },
    ] },
  },
}

function digest(data: GraphData): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
}

function median(samples: number[]): number {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.floor(ordered.length / 2)]
}

function time(runs: number, task: () => void): { median: number; max: number } {
  task() // warm-up
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    task()
    samples.push(performance.now() - start)
  }
  return { median: median(samples), max: Math.max(...samples) }
}

function sameVisibility(a: { nodes: Set<string>; edges: Set<string> }, b: { nodes: Set<string>; edges: Set<string> }): boolean {
  return a.nodes.size === b.nodes.size && a.edges.size === b.edges.size &&
    [...a.nodes].every(id => b.nodes.has(id)) && [...a.edges].every(id => b.edges.has(id))
}

function run(nodeCount: number): void {
  const { data, properties } = generate(nodeCount, 20261012)
  let lookups = 0
  const lookup: PropertyLookup = element => { lookups++; return properties.get(element) ?? {} }
  const before = digest(data)
  const runs = nodeCount >= 50_000 ? 7 : 15

  console.log(`\n## ${nodeCount.toLocaleString('en')} nodes / ${data.edges.length.toLocaleString('en')} edges (${runs} timed runs, median / max ms)`)
  console.log('| view | evaluateView | visible nodes | visible edges | lookups/eval | index load | 1k node upserts | 1k edge upserts | setView |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')

  for (const [name, view] of Object.entries(VIEWS)) {
    let visibility = evaluateView(data, view, lookup)
    lookups = 0
    const evaluate = time(runs, () => { visibility = evaluateView(data, view, lookup) })
    const lookupsPerEval = lookups / (runs + 1)

    const index = new ViewIndex(view, lookup)
    const load = time(runs, () => index.load(data))
    if (!sameVisibility(index.visibility(), visibility)) throw new Error(`index/evaluateView mismatch for ${name}`)

    // Re-upsert existing elements (property cache unchanged): measures incremental bookkeeping.
    const next = random(nodeCount)
    const nodeSample = Array.from({ length: 1000 }, () => data.nodes[Math.floor(next() * data.nodes.length)])
    const edgeSample = Array.from({ length: 1000 }, () => data.edges[Math.floor(next() * data.edges.length)])
    const nodeUpserts = time(runs, () => { for (const node of nodeSample) index.upsertNode(node) })
    const edgeUpserts = time(runs, () => { for (const edge of edgeSample) index.upsertEdge(edge) })
    const switchView = time(Math.min(runs, 5), () => { index.setView(undefined); index.setView(view) })
    if (!sameVisibility(index.visibility(), visibility)) throw new Error(`index drift after upserts for ${name}`)

    const cell = (t: { median: number; max: number }) => `${t.median.toFixed(2)} / ${t.max.toFixed(2)}`
    console.log(`| ${name} | ${cell(evaluate)} | ${visibility.nodes.size} | ${visibility.edges.size} | ${lookupsPerEval.toFixed(0)} | ${cell(load)} | ${cell(nodeUpserts)} | ${cell(edgeUpserts)} | ${cell(switchView)} (two switches) |`)
  }

  const after = digest(data)
  if (before !== after) throw new Error(`model changed: ${before} -> ${after}`)
  const heap = process.memoryUsage().heapUsed / 1024 / 1024
  console.log(`\nModel preservation: sha256(JSON) ${before} before and after all runs (unchanged). Heap used ${heap.toFixed(0)} MiB.`)
}

const sizes = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n > 0)
console.log(`# Filter benchmark — node ${process.version}, ${process.platform}/${process.arch}`)
for (const size of sizes.length > 0 ? sizes : [1_000, 10_000, 50_000]) run(size)
