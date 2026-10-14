// Authored by Codex (LLM agent). Canvas-local schema, validation and explicit defaults.
import { parseDocument } from 'yaml'
import { parseProperties } from './properties'
import type { CanvasPropertySchema, ElementSchema, PropertyMap, PropertyValue, SchemaField, SchemaFieldType, SchemaIssue } from './types'
export type { SchemaIssue } from './types'

export type ElementKind = 'nodes' | 'edges'
export interface SchemaSelection { status: 'none' | 'valid' | 'unsupported'; definition?: ElementSchema; error?: string }
const fieldTypes = new Set<SchemaFieldType>(['text', 'number', 'boolean', 'date', 'list', 'object'])
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key) === true
function record(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${location} must be an object`)
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw Error(`${location} must be an object`)
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) throw Error(`${location} must not contain accessors`)
  return value as Record<string, unknown>
}
function jsonValue(value: unknown, location: string, ancestors = new Set<object>(), depth = 0): PropertyValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object' || ancestors.has(value) || depth > 50) throw Error(`${location} must be a finite JSON value without cycles`)
  const next = new Set(ancestors); next.add(value)
  if (Array.isArray(value)) {
    if (value.length > 10000) throw Error(`${location} has too many items`)
    return value.map(item => jsonValue(item, location, next, depth + 1))
  }
  const source = record(value, location), result: PropertyMap = Object.create(null) as PropertyMap
  if (Object.keys(source).length > 10000) throw Error(`${location} has too many keys`)
  for (const key of Object.keys(source)) result[key] = jsonValue(source[key], location, next, depth + 1)
  return result
}
export function isSchemaDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}
function matchesType(value: PropertyValue, field: SchemaField): boolean {
  if (value === null) return field.nullable === true
  switch (field.type) {
    case 'text': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'date': return isSchemaDate(value)
    case 'list': return Array.isArray(value)
    case 'object': return typeof value === 'object' && !Array.isArray(value)
  }
}
function equal(left: PropertyValue, right: PropertyValue): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]))
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => owns(right, key) && equal(left[key], right[key]))
}
function fieldIssue(value: PropertyValue, field: SchemaField): string | undefined {
  if (!matchesType(value, field)) return `Expected ${field.type}${field.nullable ? ' or null' : ''}`
  if (field.options && schemaOptionIndex(field.options, value) < 0) return 'Choose one of the allowed values'
  return undefined
}
export function schemaOptionIndex(options: PropertyValue[], value: PropertyValue): number {
  return options.findIndex(option => equal(value, option))
}
function validateDefinition(value: unknown, location: string): ElementSchema {
  const source = record(value, location)
  if (!Array.isArray(source.fields) || source.fields.length > 200) throw Error(`${location}.fields must be a list of at most 200 fields`)
  if (source.allowAdditional !== undefined && typeof source.allowAdditional !== 'boolean') throw Error(`${location}.allowAdditional must be true or false`)
  const keys = new Set<string>()
  const fields = source.fields.map((raw, index): SchemaField => {
    const path = `${location}.fields[${index}]`, data = record(raw, path)
    if (typeof data.key !== 'string' || !data.key.trim()) throw Error(`${path}.key must be a nonempty literal property key`)
    if (keys.has(data.key)) throw Error(`${path}: duplicate key ${data.key}`)
    keys.add(data.key)
    if (!fieldTypes.has(data.type as SchemaFieldType)) throw Error(`${path}.type must be text, number, boolean, date, list or object`)
    for (const flag of ['required', 'nullable']) if (data[flag] !== undefined && typeof data[flag] !== 'boolean') throw Error(`${path}.${flag} must be true or false`)
    if (data.description !== undefined && typeof data.description !== 'string') throw Error(`${path}.description must be text`)
    const field = { ...data, key: data.key, type: data.type as SchemaFieldType } as SchemaField
    if (owns(data, 'options')) {
      if (!Array.isArray(data.options) || !data.options.length || data.options.length > 200) throw Error(`${path}.options must be a nonempty list of at most 200 values`)
      field.options = data.options.map(option => jsonValue(option, `${path}.options`))
      if (field.options.some(option => !matchesType(option, field))) throw Error(`${path}.options contains a value with the wrong type`)
    }
    if (owns(data, 'default')) {
      field.default = jsonValue(data.default, `${path}.default`)
      const issue = fieldIssue(field.default, field)
      if (issue) throw Error(`${path}.default: ${issue}`)
    }
    return field
  })
  return { ...source, fields, allowAdditional: source.allowAdditional !== false }
}
export function validateSchema(value: unknown): CanvasPropertySchema {
  const source = record(value, 'schema')
  if (source.version !== 1) throw Error('Unsupported schema version; original schema is preserved')
  return { ...source, version: 1, nodes: validateDefinition(source.nodes, 'nodes'), edges: validateDefinition(source.edges, 'edges') }
}
export function schemaFor(config: unknown, kind: ElementKind): SchemaSelection {
  try {
    if (config === undefined) return { status: 'none' }
    const configuration = record(config, 'Property graph configuration')
    if (configuration.version !== 1) throw Error('Unsupported property graph configuration')
    if (!owns(configuration, 'schema')) return { status: 'none' }
    return { status: 'valid', definition: validateSchema(configuration.schema)[kind] }
  } catch (error) { return { status: 'unsupported', error: String(error instanceof Error ? error.message : error) } }
}
export function validatePropertyMap(values: PropertyMap, definition: ElementSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [], known = new Set<string>()
  for (const field of definition.fields) {
    known.add(field.key)
    if (!owns(values, field.key)) { if (field.required) issues.push({ key: field.key, message: 'Required property is missing' }); continue }
    const message = fieldIssue(values[field.key], field)
    if (message) issues.push({ key: field.key, message })
  }
  if (!definition.allowAdditional) for (const key of Object.keys(values)) if (!known.has(key)) issues.push({ key, message: 'Additional properties are not allowed by this schema' })
  return issues
}
export function validateElementProperties(config: unknown, kind: ElementKind, values: PropertyMap): SchemaIssue[] {
  const selected = schemaFor(config, kind)
  if (selected.status === 'unsupported') return [{ key: '', message: selected.error! }]
  return selected.definition ? validatePropertyMap(values, selected.definition) : []
}
export function schemaDefaults(definition: ElementSchema): PropertyMap {
  const result: PropertyMap = Object.create(null) as PropertyMap
  for (const field of definition.fields) if (owns(field, 'default')) result[field.key] = jsonValue(field.default, `Default for ${field.key}`)
  return result
}
export function applySchemaDefaults(yaml: string, definition: ElementSchema): { yaml: string; added: string[] } {
  const parsed = parseProperties(yaml)
  if (!parsed.values) throw Error(parsed.errors.map(error => `${error.line}:${error.column} ${error.message}`).join('\n'))
  const defaults = schemaDefaults(definition), added = Object.keys(defaults).filter(key => !owns(parsed.values!, key))
  if (!added.length) return { yaml, added }
  const document = parseDocument(yaml, { version: '1.2', schema: 'core', uniqueKeys: true })
  for (const key of added) document.set(key, defaults[key])
  const result = document.toString({ lineWidth: 0 })
  if (parseProperties(result).errors.length) throw Error('Could not apply defaults without changing valid YAML')
  return { yaml: result, added }
}
