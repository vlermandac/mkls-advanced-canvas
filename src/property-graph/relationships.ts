// Authored by Codex (LLM agent). Directed endpoint rules offer choices without enforcing edges.
import { parseProperties } from './properties'
import type { GraphElement, RelationChoice, RelationshipGuidance, RelationshipRule } from './types'

export interface RelationshipGuidanceResult { status: 'none' | 'valid' | 'unsupported'; value?: RelationshipGuidance; error?: string }
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key) === true
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path} must be an object`)
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) throw Error(`${path} must be a plain object`)
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) throw Error(`${path} must not contain accessors`)
  return value as Record<string, unknown>
}
function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${path} must be nonempty text`)
  return value
}
function names(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw Error(`${path} must contain between 1 and 200 type names`)
  const result = value.map((entry, index) => name(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length) throw Error(`${path} contains duplicate type names`)
  return result
}
export function validateRelationshipGuidance(value: unknown): RelationshipGuidance {
  const data = object(value, 'relationships')
  if (data.version !== 1) throw Error('Unsupported relationship rules version; original data is preserved')
  const nodeTypeKey = name(data.nodeTypeKey, 'nodeTypeKey'), edgeTypeKey = name(data.edgeTypeKey, 'edgeTypeKey')
  if (!Array.isArray(data.rules) || data.rules.length > 200) throw Error('rules must contain at most 200 rules')
  const ids = new Set<string>()
  const rules = data.rules.map((raw, index): RelationshipRule => {
    const path = `rules[${index}]`, rule = object(raw, path), id = name(rule.id, `${path}.id`)
    if (ids.has(id)) throw Error(`${path}.id is duplicated`)
    ids.add(id)
    if (rule.name !== undefined && typeof rule.name !== 'string') throw Error(`${path}.name must be text`)
    return { ...rule, id, from: names(rule.from, `${path}.from`), to: names(rule.to, `${path}.to`), relations: names(rule.relations, `${path}.relations`) }
  })
  return { ...data, version: 1, nodeTypeKey, edgeTypeKey, rules }
}
export function relationshipGuidance(config: unknown): RelationshipGuidanceResult {
  try {
    if (config === undefined) return { status: 'none' }
    const data = object(config, 'Property graph configuration')
    if (data.version !== 1) throw Error('Unsupported property graph configuration')
    if (!owns(data, 'relationships')) return { status: 'none' }
    return { status: 'valid', value: validateRelationshipGuidance(data.relationships) }
  } catch (error) { return { status: 'unsupported', error: String(error instanceof Error ? error.message : error) } }
}
function nodeTypes(element: GraphElement, key: string): string[] {
  const record = element.propertyGraph
  if (record !== undefined && (record?.version !== 1 || typeof record?.yaml !== 'string')) return []
  const values = parseProperties(record?.yaml ?? '').values
  if (!values || !owns(values, key)) return []
  const value = values[key]
  if (typeof value === 'string') return [value]
  // A mixed list is unsupported, rather than silently guessing a type from it.
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : []
}
export function relationChoices(config: unknown, source: GraphElement, target: GraphElement): RelationChoice[] {
  const result = relationshipGuidance(config)
  if (!result.value) return []
  const from = new Set(nodeTypes(source, result.value.nodeTypeKey)), to = new Set(nodeTypes(target, result.value.nodeTypeKey))
  if (!from.size || !to.size) return []
  const choices = new Map<string, RelationChoice>()
  for (const rule of result.value.rules) {
    if (!rule.from.some(type => from.has(type)) || !rule.to.some(type => to.has(type))) continue
    for (const type of rule.relations) {
      let choice = choices.get(type)
      if (!choice) choices.set(type, choice = { type, ruleIds: [], ruleNames: [] })
      choice.ruleIds.push(rule.id); choice.ruleNames.push(rule.name?.trim() || `${rule.from.join(', ')} → ${rule.to.join(', ')}`)
    }
  }
  return [...choices.values()]
}
