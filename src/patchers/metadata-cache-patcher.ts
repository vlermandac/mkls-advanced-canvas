import { CachedMetadata, MetadataCache, Notice, TFile } from "obsidian"
import { ExtendedCachedMetadata } from "src/@types/Obsidian"
import FilepathHelper from "src/utils/filepath-helper"
import HashHelper from "src/utils/hash-helper"
import { computeCanvasMetadata, TextMetadataCache } from "src/utils/metadata-index-cache"
import TaskQueue from "src/utils/task-queue"
import Patcher, { invoke } from "./patcher"

export default class MetadataCachePatcher extends Patcher {
  protected async patch() {
    if (!this.plugin.settings.getSetting('canvasMetadataCompatibilityEnabled')) return

    Patcher.patchPrototype<MetadataCache>(this.plugin, this.plugin.app.metadataCache, {
      getCache: Patcher.OverrideExisting(next => function (filepath: string, ...args: unknown[]): CachedMetadata | null {
        // Bypass the "md" extension check by handling the "canvas" extension here
        if (FilepathHelper.extension(filepath) === 'canvas') {
          if (!Object.prototype.hasOwnProperty.call(this.fileCache, filepath))
            return null

          const hash = this.fileCache[filepath]?.hash
          return (hash && this.metadataCache[hash]) || null
        }

        return invoke(next, this, filepath, ...args)
      }),
      computeFileMetadataAsync: Patcher.OverrideExisting(next => async function (file: TFile, ...args: unknown[]) {
        if (file instanceof TFile && file?.extension === 'canvas')
          return invoke(computeCanvasFileMetadataAsync, this, file)

        return invoke(next, this, file, ...args)
      }),
      resolveLinks: Patcher.OverrideExisting(next => async function (filepath: string) {
        const result = invoke(next, this, filepath)

        // Run custom logic that triggers 'resolve' and 'resolved' events
        if (FilepathHelper.extension(filepath) === 'canvas')
          await invoke(resolveCanvasLinks, this, filepath)

        return result
      })
    })
  }
}

const metadataQueue = new TaskQueue()
const linkResolveQueue = new TaskQueue()

async function computeCanvasFileMetadataAsync(this: MetadataCache, file: TFile) {
  this.uniqueFileLookup.add(file.name.toLowerCase(), file)

  let isStale = true
  const cache = this.fileCache[file.path]
  if (!cache) this.saveFileCache(file.path, { mtime: 0, size: 0, hash: "" })
  else {
    const unchanged = cache.mtime === file.stat.mtime && cache.size === file.stat.size
    // Codex (LLM agent): old native/upstream hashes can lack stable element IDs.
    const hasMetadataCache = !!(cache.hash && (this.metadataCache[cache.hash] as ExtendedCachedMetadata | undefined)?.mklsMetadataVersion === 1)

    if (unchanged && hasMetadataCache)
      isStale = false
  }

  if (isStale) {
    linkResolveQueue.setOnFinished(() => this.trigger('finished'))
    await metadataQueue.add(
      () => invoke(updateMetadataCache, this, file)
    )
  }

  linkResolveQueue.setOnFinished(() => this.trigger('resolved'))
  await linkResolveQueue.add(
    () => invoke(resolveCanvasLinks, this, file.path)
  )
}

async function updateMetadataCache(this: MetadataCache, file: TFile) {
  const bytes = await this.vault.readBinary(file)
  const data = new TextDecoder().decode(new Uint8Array(bytes))
  const hash = await HashHelper.getBytesHash(bytes)

  const cache = {
    mtime: file.stat.mtime,
    size: file.stat.size,
    hash: hash
  }
  this.saveFileCache(file.path, cache)

  let metadata = this.metadataCache[cache.hash] as ExtendedCachedMetadata | undefined
  if (metadata?.mklsMetadataVersion === 1) return this.trigger(
    "changed", file, data, metadata
  )

  const slowIndexingTimeout = window.setTimeout(() => {
    new Notice(`Canvas indexing taking a long time for file ${file.path}`)
  }, 10000)

  try {
    metadata = await invoke(computeCanvasMetadataAsync, this, data)
  } finally {
    window.clearTimeout(slowIndexingTimeout)
  }

  if (metadata) {
    this.saveMetaCache(hash, metadata)
    this.trigger("changed", file, data, metadata)
  } else {
    console.error("Canvas metadata failed to parse", file)
  }
}

// Claude (LLM agent): per-node parsing goes through a bounded exact-text cache with bounded
// concurrency instead of re-parsing every text node of the file with an unbounded Promise.all.
// Output (nodes, links, embeds and their positions) is built by computeCanvasMetadata.
const NODE_METADATA_CONCURRENCY = 8
const nodeMetadataCache = new TextMetadataCache<CachedMetadata>({ maxEntries: 20_000, maxTextLength: 32 * 1024 * 1024 })

async function computeCanvasMetadataAsync(this: MetadataCache, data: string): Promise<ExtendedCachedMetadata> {
  return computeCanvasMetadata(data, {
    computeText: async text => await this.computeMetadataAsync(new TextEncoder().encode(text).buffer) ?? null,
    cache: nodeMetadataCache,
    concurrency: NODE_METADATA_CONCURRENCY
  })
}

async function resolveCanvasLinks(this: MetadataCache, filepath: string) {
  const file = this.vault.getAbstractFileByPath(filepath)
  if (!(file instanceof TFile)) return

  const metadata = this.getFileCache(file)
  const references = [...(metadata?.links ?? []), ...(metadata?.embeds ?? [])]
  const referenceLinks = references.map(ref => ref.link).sort()

  const resolvedLinks: Record<string, number> = {}
  const unresolvedLinks: Record<string, number> = {}

  for (const link of referenceLinks) {
    const resolved = this.getFirstLinkpathDest(link, filepath)

    if (resolved) {
      resolvedLinks[resolved.path] ??= 0
      resolvedLinks[resolved.path]++
    } else {
      const strippedLink = link.endsWith('.md') ? link.slice(0, -3) : link

      unresolvedLinks[strippedLink] ??= 0
      unresolvedLinks[strippedLink]++
    }
  }

  this.resolvedLinks[filepath] = resolvedLinks
  this.unresolvedLinks[filepath] = unresolvedLinks

  await sleep(1)
  this.trigger('resolve', file)
}
