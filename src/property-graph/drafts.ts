// Authored by Codex (LLM agent). Recovery drafts are separate from committed graph data.
interface Adapter {
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>
  read(path: string): Promise<string>; write(path: string, data: string): Promise<void>
}
export interface SourceDraft { file: string; id: string; source: string; revision: string; savedAt: string; kind?: 'source' | 'yaml' }
export function sourceRevision(data: { propertyGraph?: { yaml?: string; draft?: string }; [key: string]: unknown }): string {
  return JSON.stringify([data.type, data.text ?? data.label ?? '', data.file, data.url, data.propertyGraph?.yaml ?? '', data.propertyGraph?.draft])
}
export class DraftStore {
  private writes: Promise<void> = Promise.resolve()
  private memory = new Map<string, SourceDraft | undefined>()
  constructor(private adapter: Adapter, private folder: string) {}
  private async path(file: string, id: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([file, id])))
    return this.folder + '/' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') + '.json'
  }
  async read(file: string, id: string): Promise<SourceDraft | undefined> {
    const key = JSON.stringify([file, id])
    if (this.memory.has(key)) return this.memory.get(key)
    const path = await this.path(file, id)
    if (!await this.adapter.exists(path)) return undefined
    try {
      const draft = JSON.parse(await this.adapter.read(path)) as SourceDraft | null
      return draft?.file === file && draft.id === id && typeof draft.source === 'string' && typeof draft.revision === 'string' ? draft : undefined
    } catch { return undefined }
  }
  save(draft: SourceDraft): Promise<void> {
    this.memory.set(JSON.stringify([draft.file, draft.id]), draft)
    if (this.memory.size > 256) for (const oldest of this.memory.keys()) { this.memory.delete(oldest); break }
    const write = this.writes.catch(() => {}).then(async () => {
      if (!await this.adapter.exists(this.folder)) await this.adapter.mkdir(this.folder)
      const path = await this.path(draft.file, draft.id)
      // Bounded archive; consuming the latest pointer never deletes recovery history.
      const historyPath = path.replace(/\.json$/, '.history.json')
      let history: SourceDraft[] = []
      if (await this.adapter.exists(historyPath)) {
        try { const value: unknown = JSON.parse(await this.adapter.read(historyPath)); if (Array.isArray(value)) history = value as SourceDraft[] } catch { /* Preserve the current draft even when an old archive is malformed. */ }
      }
      await this.adapter.write(historyPath, JSON.stringify([...history.slice(-19), draft]))
      await this.adapter.write(path, JSON.stringify(draft))
    })
    this.writes = write; return write
  }
  consume(file: string, id: string): Promise<void> {
    this.memory.set(JSON.stringify([file, id]), undefined)
    if (this.memory.size > 256) for (const oldest of this.memory.keys()) { this.memory.delete(oldest); break }
    const write = this.writes.catch(() => {}).then(async () => {
      const path = await this.path(file, id)
      if (await this.adapter.exists(path)) await this.adapter.write(path, JSON.stringify({ file, id, consumed: true }))
    })
    this.writes = write; return write
  }
}
