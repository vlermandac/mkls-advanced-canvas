// Authored by Codex (LLM agent) for the MKLS-maintained fork.
import { LineCounter, parseDocument } from 'yaml'
import type { GraphElement, PropertyMap, PropertyValue } from './types'

export interface PropertyDiagnostic { message: string; line: number; column: number }
export interface ParsedProperties { values: PropertyMap | null; errors: PropertyDiagnostic[] }

function normalize(value: unknown, ancestors = new Set<object>()): PropertyValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new TypeError('Properties must contain finite JSON values without cycles')
  const next = new Set(ancestors); next.add(value)
  if (Array.isArray(value)) return value.map(item => normalize(item, next))
  if (!(value instanceof Map)) throw new TypeError('Unsupported property value')
  const result: PropertyMap = Object.create(null) as PropertyMap
  for (const [key, item] of value) {
    if (typeof key !== 'string') throw new TypeError('Property keys must be strings')
    result[key] = normalize(item, next)
  }
  return result
}

export function parseProperties(yaml: string): ParsedProperties {
  if (!yaml.trim()) return { values: Object.create(null) as PropertyMap, errors: [] }
  const lineCounter = new LineCounter()
  try {
    const doc = parseDocument(yaml, { version: '1.2', schema: 'core', uniqueKeys: true, lineCounter })
    const errors = [...doc.errors, ...doc.warnings].map(error => {
      const position = lineCounter.linePos(error.pos[0])
      return { message: error.message, line: position.line, column: position.col }
    })
    if (errors.length) return { values: null, errors }
    const raw: unknown = doc.toJS({ mapAsMap: true, maxAliasCount: 50 })
    // Codex (LLM agent): comments alone are an empty property map; an explicit
    // YAML null scalar remains invalid because it has a contents node.
    if (raw === null && doc.contents === null) return { values: Object.create(null) as PropertyMap, errors: [] }
    if (!(raw instanceof Map)) throw new TypeError('Frontmatter must be a property mapping')
    return { values: normalize(raw) as PropertyMap, errors: [] }
  } catch (error) {
    return { values: null, errors: [{ message: String(error instanceof Error ? error.message : error), line: 1, column: 1 }] }
  }
}

export class PropertyService {
  private cache = new Map<string, { yaml: string; parsed: ParsedProperties }>()
  parseCount = 0
  get(element: GraphElement): ParsedProperties {
    if (element.propertyGraph !== undefined && (element.propertyGraph?.version !== 1 || typeof element.propertyGraph?.yaml !== 'string')) return { values: null, errors: [{ message: 'Unsupported or malformed property record; original data is preserved', line: 1, column: 1 }] }
    const yaml = typeof element.propertyGraph?.yaml === 'string' ? element.propertyGraph.yaml : ''
    const previous = this.cache.get(element.id)
    if (previous?.yaml === yaml) return previous.parsed
    this.parseCount++
    const parsed = parseProperties(yaml)
    this.cache.set(element.id, { yaml, parsed })
    return parsed
  }
  delete(id: string): void { this.cache.delete(id) }
  clear(): void { this.cache.clear() }
}

export function editingSource(yaml: string, body: string): string {
  return '---\n' + yaml + (yaml && !yaml.endsWith('\n') ? '\n' : '') + '---\n' + body
}

export function splitEditingSource(source: string): { yaml: string; body: string } {
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(source)
  if (!opening) throw new TypeError('Start frontmatter with --- on its own line')
  const tail = source.slice(opening[0].length)
  const closing = /^---(?:\r?\n|$)/m.exec(tail)
  if (!closing) throw new TypeError('Close frontmatter with --- on its own line')
  return { yaml: tail.slice(0, closing.index), body: tail.slice(closing.index + closing[0].length) }
}
