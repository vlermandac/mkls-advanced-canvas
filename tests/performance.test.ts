// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
// Regressions for incremental canvas indexing and selection highlighting helpers.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CachedMetadata } from 'obsidian'
import { computeCanvasMetadata, mapWithConcurrency, setTransition, TextMetadataCache } from '../src/utils/metadata-index-cache'

// --- fixtures -------------------------------------------------------------------------------

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

const tick = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Stand-in for MetadataCache.computeMetadataAsync: wikilinks become links, ![[x]] embeds. */
function fakeParse(text: string): CachedMetadata {
  const links: CachedMetadata['links'] = []
  const embeds: CachedMetadata['embeds'] = []
  for (const match of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
    const position = { start: { line: 0, col: match.index, offset: match.index }, end: { line: 0, col: match.index + match[0].length, offset: match.index + match[0].length } }
    const entry = { link: match[2], original: match[0], displayText: match[2], position }
    if (match[1]) embeds.push(entry)
    else links.push(entry)
  }
  return { links, embeds, sections: [{ type: 'paragraph', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: text.length, offset: text.length } } }] }
}

function counter(delay: () => number = () => 0) {
  const state = { calls: 0, inFlight: 0, maxInFlight: 0 }
  const computeText = async (text: string) => {
    state.calls++
    state.inFlight++
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    await tick(delay())
    state.inFlight--
    return text === 'FAIL-TO-PARSE' ? null : fakeParse(text)
  }
  return { state, computeText }
}

function canvasJson(texts: string[], extra: object[] = []): string {
  return JSON.stringify({
    metadata: { version: '1.0-1.0', frontmatter: { related: ['[[A|alias]]', 'plain'], single: '[[B]]' } },
    nodes: [
      ...texts.map((text, i) => ({ id: `t${i}`, type: 'text', text, x: 0, y: i * 100, width: 200, height: 80 })),
      ...extra,
    ],
    edges: [],
  })
}

/** The pre-change implementation (whole-file Promise.all), kept as the behavioral reference. */
async function referenceMetadata(data: string, computeText: (text: string) => Promise<CachedMetadata | null>) {
  const content = JSON.parse(data || '{}') as { metadata?: { frontmatter?: Record<string, unknown> }; nodes?: { id: string; type: string; text?: string; file?: string }[] }
  const metadata: Record<string, unknown> & { links: unknown[]; embeds: unknown[]; nodes: Record<string, unknown>; frontmatterLinks: unknown[] } =
    { v: 1, links: [], embeds: [], nodes: {}, frontmatterLinks: [] }
  const frontmatter = content.metadata?.frontmatter
  metadata.frontmatterPosition = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } }
  metadata.frontmatter = frontmatter
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    const getLinks = (values: string[]) => values.map(v => {
      if (!v.startsWith('[[') || !v.endsWith(']]')) return null
      const [link, ...aliases] = v.slice(2, -2).split('|')
      return { key, displayText: aliases.length > 0 ? aliases.join('|') : link, link: link ?? v, original: v }
    }).filter(v => v !== null)
    if (typeof value === 'string') metadata.frontmatterLinks.push(...getLinks([value]))
    else if (Array.isArray(value)) metadata.frontmatterLinks.push(...getLinks(value as string[]))
  }
  await Promise.all((content.nodes ?? []).map(async (node, index) => {
    if (node.type !== 'text') return
    const nodeMetadata = await computeText(node.text ?? '')
    if (!nodeMetadata) return
    metadata.nodes[node.id] = nodeMetadata
    metadata.links.push(...(nodeMetadata.links ?? []).map(link => ({ ...link, position: { nodeId: node.id, start: { line: 0, col: 1, offset: 0 }, end: { line: 0, col: 1, offset: index } } })))
    metadata.embeds.push(...(nodeMetadata.embeds ?? []).map(embed => ({ ...embed, position: { nodeId: node.id, start: { line: 0, col: 1, offset: 0 }, end: { line: 0, col: 1, offset: index } } })))
  }))
  for (const [index, node] of (content.nodes ?? []).entries()) {
    if (node.type !== 'file' || !node.file) continue
    metadata.embeds.push({ link: node.file, original: node.file, displayText: node.file, position: { start: { line: 0, col: 1, offset: 0 }, end: { line: 0, col: 1, offset: index } } })
  }
  return metadata
}

const byPosition = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b))

// --- canvas metadata ------------------------------------------------------------------------

describe('computeCanvasMetadata', () => {
  const texts = ['See [[Alpha]] and ![[img.png]]', '', 'No links', 'Twice [[Alpha]] [[Beta|b]]', 'FAIL-TO-PARSE', 'See [[Alpha]] and ![[img.png]]']
  const files = [{ id: 'f1', type: 'file', file: 'notes/Gamma.md', x: 0, y: 0, width: 1, height: 1 }, { id: 'g', type: 'group', x: 0, y: 0, width: 1, height: 1 }]

  it('produces the same metadata, link positions and embeds as the whole-file implementation', async () => {
    const data = canvasJson(texts, files)
    const next = random(1)
    const reference = await referenceMetadata(data, counter(() => next() * 3).computeText)
    const actual = await computeCanvasMetadata(data, { computeText: counter(() => next() * 3).computeText, concurrency: 3, cache: new TextMetadataCache({ maxEntries: 100, maxTextLength: 10_000 }) })

    // Codex (LLM agent): the intentional new stable ID is additional metadata;
    // compare the remaining structure against unchanged upstream semantics.
    const legacyEmbeds = actual.embeds!.map(embed => { const position = { ...embed.position }; if (position.nodeId === 'f1') delete position.nodeId; return { ...embed, position } })
    assert.equal(actual.embeds!.find(embed => embed.link === 'notes/Gamma.md')?.position.nodeId, 'f1')
    const { mklsMetadataVersion, ...legacyActual } = actual
    assert.equal(mklsMetadataVersion,1)
    assert.deepEqual({ ...legacyActual, links: [...actual.links!].sort(byPosition), embeds: legacyEmbeds.sort(byPosition) },
      { ...reference, links: [...reference.links].sort(byPosition), embeds: [...reference.embeds].sort(byPosition) })
    assert.equal(actual.nodes!['t4'], undefined, 'unparsable nodes are omitted as before')
    assert.deepEqual(actual.frontmatterLinks!.map(link => link.link), ['A', 'B'])
  })

  it('orders node links and embeds deterministically by node index', async () => {
    const actual = await computeCanvasMetadata(canvasJson(texts, files), { computeText: counter(() => Math.random() * 3).computeText, concurrency: 4 })
    assert.deepEqual(actual.links!.map(link => `${link.position.nodeId}:${link.link}`), ['t0:Alpha', 't3:Alpha', 't3:Beta|b', 't5:Alpha'])
    assert.deepEqual(actual.embeds!.map(embed => embed.position.end.offset), [0, 5, 6], 'node embeds by index, then file embeds')
  })

  it('re-parses only edited text nodes on later saves (measured worker calls)', async () => {
    const nodeCount = 2000
    const baseTexts = Array.from({ length: nodeCount }, (_, i) => `Node ${i} links [[Note ${i % 50}]]`)
    const cache = new TextMetadataCache<CachedMetadata>({ maxEntries: 20_000, maxTextLength: 32 * 1024 * 1024 })
    const uncached = counter()
    const cached = counter()

    await computeCanvasMetadata(canvasJson(baseTexts), { computeText: uncached.computeText, concurrency: 8 })
    await computeCanvasMetadata(canvasJson(baseTexts), { computeText: cached.computeText, concurrency: 8, cache })
    assert.equal(uncached.state.calls, nodeCount)
    assert.equal(cached.state.calls, nodeCount, 'cold cache parses every node once')

    const edited = [...baseTexts]
    edited[1234] = 'Edited [[Somewhere]]'
    const before = cached.state.calls
    const hitsBefore = cache.stats.hits
    const result = await computeCanvasMetadata(canvasJson(edited), { computeText: cached.computeText, concurrency: 8, cache })
    await computeCanvasMetadata(canvasJson(edited), { computeText: uncached.computeText, concurrency: 8 })

    assert.equal(cached.state.calls - before, 1, 'one edited node -> one parse')
    assert.equal(cache.stats.hits - hitsBefore, nodeCount - 1)
    assert.equal(uncached.state.calls, nodeCount * 2, 'the former implementation re-parses all nodes')
    assert.equal(result.links!.find(link => link.position.nodeId === 't1234')!.link, 'Somewhere')
    console.log(`# metadata save after 1 edit of ${nodeCount} nodes: worker calls cached=1 vs uncached=${nodeCount}; cache entries=${cache.size}, hits=${cache.stats.hits}, misses=${cache.stats.misses}`)
  })

  it('bounds concurrent worker calls', async () => {
    const next = random(3)
    const tracked = counter(() => next() * 2)
    await computeCanvasMetadata(canvasJson(Array.from({ length: 200 }, (_, i) => `n${i}`)), { computeText: tracked.computeText, concurrency: 8 })
    assert.equal(tracked.state.maxInFlight, 8)

    const unbounded = counter(() => next() * 2)
    await referenceMetadata(canvasJson(Array.from({ length: 200 }, (_, i) => `n${i}`)), unbounded.computeText)
    assert.equal(unbounded.state.maxInFlight, 200, 'former implementation queued every node at once')
  })

  it('returns metadata that can be mutated without corrupting the cache', async () => {
    const cache = new TextMetadataCache<CachedMetadata>({ maxEntries: 10, maxTextLength: 10_000 })
    const options = { computeText: counter().computeText, concurrency: 2, cache }
    const first = await computeCanvasMetadata(canvasJson(['[[Alpha]]']), options)
    first.nodes!['t0'].links![0].link = 'Mutated'
    const second = await computeCanvasMetadata(canvasJson(['[[Alpha]]']), options)
    assert.equal(second.nodes!['t0'].links![0].link, 'Alpha')
    assert.equal(cache.stats.hits, 1)
  })

  it('does not cache failed parses', async () => {
    const cache = new TextMetadataCache<CachedMetadata>({ maxEntries: 10, maxTextLength: 10_000 })
    const tracked = counter()
    for (let i = 0; i < 2; i++) await computeCanvasMetadata(canvasJson(['FAIL-TO-PARSE']), { computeText: tracked.computeText, concurrency: 1, cache })
    assert.equal(tracked.state.calls, 2)
    assert.equal(cache.size, 0)
  })
})

// --- helpers --------------------------------------------------------------------------------

describe('TextMetadataCache', () => {
  it('evicts least recently used entries by count and total text length', () => {
    const cache = new TextMetadataCache<number>({ maxEntries: 3, maxTextLength: 10 }, value => value)
    cache.set('aa', 1); cache.set('bb', 2); cache.set('cc', 3)
    assert.equal(cache.get('aa'), 1) // aa becomes most recent
    cache.set('dd', 4)
    assert.equal(cache.get('bb'), undefined, 'least recently used entry evicted')
    assert.deepEqual([cache.get('aa'), cache.get('cc'), cache.get('dd')], [1, 3, 4])

    cache.set('eeeeeee', 5) // 7 chars: total would be 13 > 10
    assert.ok(cache.totalTextLength <= 10)
    assert.equal(cache.get('eeeeeee'), 5)
    cache.set('x'.repeat(11), 6)
    assert.equal(cache.get('x'.repeat(11)), undefined, 'over-long texts are not cached')
    assert.ok(cache.size <= 3 && cache.stats.evictions >= 3)
  })

  it('treats texts as exact keys', () => {
    const cache = new TextMetadataCache<number>({ maxEntries: 5, maxTextLength: 100 }, value => value)
    cache.set('[[A]]', 1)
    assert.equal(cache.get('[[A]] '), undefined)
    assert.equal(cache.get('[[a]]'), undefined)
    assert.equal(cache.get('[[A]]'), 1)
  })
})

describe('mapWithConcurrency', () => {
  it('keeps input order and propagates the first failure', async () => {
    const next = random(9)
    const result = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async value => { await tick(next() * 3); return value * 10 })
    assert.deepEqual(result, [50, 40, 30, 20, 10])
    await assert.rejects(mapWithConcurrency([1, 2, 3], 2, async value => { if (value === 2) throw new Error('boom'); return value }), /boom/)
    assert.deepEqual(await mapWithConcurrency([], 4, async value => value), [])
  })
})

describe('setTransition (edge highlight)', () => {
  it('touches only previously and currently highlighted edges', () => {
    const edgeCount = 30_000
    const next = random(5)
    let previous = new Set<number>()
    let incrementalToggles = 0
    const selections = 200
    for (let i = 0; i < selections; i++) {
      const focused = new Set(Array.from({ length: 1 + Math.floor(next() * 12) }, () => Math.floor(next() * edgeCount)))
      const { on, off } = setTransition(previous, focused)
      for (const edge of off) assert.ok(previous.has(edge) && !focused.has(edge))
      assert.deepEqual(new Set(on), focused)
      incrementalToggles += on.length + off.length
      previous = focused
    }
    const fullScanToggles = selections * edgeCount
    assert.ok(incrementalToggles < selections * 30)
    console.log(`# edge highlight over ${selections} selection changes on ${edgeCount} edges: element updates incremental=${incrementalToggles} vs full scan=${fullScanToggles}`)
  })
})
