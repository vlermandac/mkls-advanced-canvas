// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Pure helpers for incremental canvas indexing. No runtime Obsidian imports (types only), so the
// module can be exercised by Node tests.
import type { CanvasData, CanvasTextNodeData } from 'assets/formats/advanced-json-canvas/spec/1.0-1.0'
import type { CachedMetadata, FrontmatterLinkCache } from 'obsidian'
import type { CanvasFileNodeData } from 'src/@types/AdvancedJsonCanvas'
import type { ExtendedCachedMetadata, ExtendedEmbedCache, ExtendedLinkCache } from 'src/@types/Obsidian'

export interface TextMetadataCacheOptions {
  /** Maximum number of cached texts. */
  maxEntries: number
  /** Maximum total length (UTF-16 code units) of cached texts; longer single texts are not cached. */
  maxTextLength: number
}

export interface TextMetadataCacheStats {
  hits: number
  misses: number
  stores: number
  evictions: number
}

/**
 * Bounded LRU cache keyed by exact text. Values are cloned on store and on read so callers can
 * keep and mutate results without corrupting shared entries.
 */
export class TextMetadataCache<V> {
  readonly stats: TextMetadataCacheStats = { hits: 0, misses: 0, stores: 0, evictions: 0 }
  private readonly entries = new Map<string, V>()
  private textLength = 0

  constructor(
    private readonly options: TextMetadataCacheOptions,
    private readonly clone: (value: V) => V = value => structuredClone(value),
  ) {}

  get size(): number { return this.entries.size }
  get totalTextLength(): number { return this.textLength }

  get(text: string): V | undefined {
    const value = this.entries.get(text)
    if (value === undefined) {
      this.stats.misses++
      return undefined
    }
    // Refresh recency
    this.entries.delete(text)
    this.entries.set(text, value)
    this.stats.hits++
    return this.clone(value)
  }

  set(text: string, value: V): void {
    if (text.length > this.options.maxTextLength || this.options.maxEntries <= 0) return

    if (this.entries.delete(text)) this.textLength -= text.length
    this.entries.set(text, this.clone(value))
    this.textLength += text.length
    this.stats.stores++

    while (this.entries.size > this.options.maxEntries || this.textLength > this.options.maxTextLength) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
      this.textLength -= oldest.length
      this.stats.evictions++
    }
  }

  clear(): void {
    this.entries.clear()
    this.textLength = 0
  }
}

/** Maps items with at most `limit` pending calls; results keep input order. Rejects like Promise.all. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await task(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  await Promise.all(workers)
  return results
}

export interface CanvasMetadataOptions {
  /** Parses one Markdown text (e.g. MetadataCache.computeMetadataAsync over its UTF-8 bytes). */
  computeText: (text: string) => Promise<CachedMetadata | null | undefined>
  cache?: TextMetadataCache<CachedMetadata>
  concurrency: number
}

/**
 * Builds the canvas file metadata. Output matches the original whole-file implementation: per
 * text node metadata under `nodes`, node links/embeds with `nodeId` positions whose end offset is
 * the node's index, then file-node embeds. Links are appended in node order (the original order
 * depended on parse completion order).
 */
export async function computeCanvasMetadata(data: string, options: CanvasMetadataOptions): Promise<ExtendedCachedMetadata> {
  const content = JSON.parse(data || '{}') as Partial<CanvasData>
  const metadata = { v: 1, mklsMetadataVersion: 1 } as Partial<ExtendedCachedMetadata>

  const frontmatter = content.metadata?.frontmatter
  metadata.frontmatterPosition = {
    start: { line: 0, col: 0, offset: 0 },
    end: { line: 0, col: 0, offset: 0 }
  }
  metadata.frontmatter = frontmatter

  metadata.frontmatterLinks = []
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    const getLinks = (value: string[]) => value.map((v) => {
      // Codex (LLM agent): native property lists may also contain non-strings.
      if (typeof v !== 'string') return null
      if (!v.startsWith('[[') || !v.endsWith(']]')) return null
      const [link, ...aliases] = v.slice(2, -2).split('|')

      return {
        key: key,
        displayText: aliases.length > 0 ? aliases.join('|') : link,
        link: link ?? v,
        original: v
      } satisfies FrontmatterLinkCache
    }).filter((v) => v !== null) as FrontmatterLinkCache[]

    if (typeof value === 'string') metadata.frontmatterLinks?.push(...getLinks([value]))
    else if (Array.isArray(value)) metadata.frontmatterLinks?.push(...getLinks(value as string[]))
  }

  const nodes = content.nodes ?? []
  const nodeMetadataList = await mapWithConcurrency(nodes, options.concurrency, async (node) => {
    if (node.type !== 'text') return null

    const text = (node as CanvasTextNodeData).text ?? '' // TextEncoder encodes undefined as ''
    const cached = options.cache?.get(text)
    if (cached) return cached

    const nodeMetadata = await options.computeText(text)
    if (nodeMetadata) options.cache?.set(text, nodeMetadata)
    return nodeMetadata ?? null
  })

  metadata.nodes = {}
  metadata.links = []
  metadata.embeds = []
  nodes.forEach((node, index) => {
    const nodeMetadata = nodeMetadataList[index]
    if (!nodeMetadata) return

    metadata.nodes![node.id] = nodeMetadata
    for (const link of nodeMetadata.links ?? []) metadata.links!.push({
      ...link,
      position: {
        nodeId: node.id,
        start: { line: 0, col: 1, offset: 0 },
        end: { line: 0, col: 1, offset: index }
      }
    } satisfies ExtendedLinkCache)
    for (const embed of nodeMetadata.embeds ?? []) metadata.embeds!.push({
      ...embed,
      position: {
        nodeId: node.id,
        start: { line: 0, col: 1, offset: 0 },
        end: { line: 0, col: 1, offset: index }
      }
    } satisfies ExtendedEmbedCache)
  })

  for (const [index, node] of nodes.entries()) {
    if (node.type !== 'file') continue

    const file = (node as CanvasFileNodeData).file
    if (!file) continue

    metadata.embeds.push({
      link: file,
      original: file,
      displayText: file,
      position: {
        // Codex (LLM agent): file-node backlink navigation uses the stable ID too.
        nodeId: node.id,
        start: { line: 0, col: 1, offset: 0 },
        end: { line: 0, col: 1, offset: index }
      }
    })
  }

  return metadata as ExtendedCachedMetadata
}

/** Elements to switch on/off when a highlighted set changes; `on` always contains all of `next`. */
export function setTransition<T>(previous: ReadonlySet<T>, next: ReadonlySet<T>): { on: T[]; off: T[] } {
  const off: T[] = []
  for (const item of previous) if (!next.has(item)) off.push(item)
  // Re-apply every current item: native re-renders may have reset the DOM class.
  return { on: Array.from(next), off }
}
