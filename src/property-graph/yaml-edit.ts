// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Single-key edits of a committed property YAML source. The document is edited through the `yaml`
// AST so comments, key order and the style of untouched entries survive. Values are written as
// typed YAML nodes: the string "false" stays a quoted string, never a boolean.
import { isMap, isScalar, parseDocument, type Document } from 'yaml'
import type { PropertyValue } from './types'

function document(yaml: string): Document {
  const doc = parseDocument(yaml, { version: '1.2', schema: 'core', uniqueKeys: true })
  if (doc.errors.length) throw new TypeError('Fix the YAML errors before editing fields')
  if (doc.contents !== null && !isMap(doc.contents)) throw new TypeError('Frontmatter must be a property mapping')
  return doc
}

function serialize(doc: Document): string {
  if (isMap(doc.contents) && doc.contents.items.length === 0 && !doc.commentBefore && !doc.comment && !doc.contents.commentBefore && !doc.contents.comment) return ''
  return doc.toString({ lineWidth: 0 })
}

/** Sets a top-level key, keeping the existing node (and its comments) when a scalar replaces a scalar. */
export function setProperty(yaml: string, key: string, value: PropertyValue): string {
  const doc = document(yaml)
  const existing = isMap(doc.contents) ? doc.contents.get(key, true) : undefined
  if (isScalar(existing) && (value === null || typeof value !== 'object')) {
    existing.value = value
    // A previous plain/quoted style may not be able to represent the new value; let yaml choose.
    if (typeof value !== 'string') existing.type = undefined
  } else doc.set(key, doc.createNode(value))
  return serialize(doc)
}

export function deleteProperty(yaml: string, key: string): string {
  const doc = document(yaml)
  doc.delete(key)
  return serialize(doc)
}

/** Block YAML for one value, used for read-only previews of nested values. */
export function previewValue(value: PropertyValue): string {
  const doc = parseDocument('', { version: '1.2', schema: 'core' })
  doc.contents = doc.createNode(value) as typeof doc.contents
  return doc.toString({ lineWidth: 0 }).trimEnd()
}

/** 1-based line of a top-level key in the source, for jumping from a field to the YAML editor. */
export function keyLine(yaml: string, key: string): number | undefined {
  const doc = parseDocument(yaml, { version: '1.2', schema: 'core', keepSourceTokens: false })
  if (!isMap(doc.contents)) return undefined
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && pair.key.value === key && pair.key.range) return yaml.slice(0, pair.key.range[0]).split('\n').length
  }
  return undefined
}
