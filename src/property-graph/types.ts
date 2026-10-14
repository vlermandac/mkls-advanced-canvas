// Authored by Codex (LLM agent) for the MKLS-maintained fork.
export type PropertyValue = string | number | boolean | null | PropertyValue[] | PropertyMap
export interface PropertyMap { [key: string]: PropertyValue }
export interface ElementProperties { version: 1; yaml: string; draft?: string }
export interface GraphElement { id: string; propertyGraph?: ElementProperties; [key: string]: unknown }
export interface GraphNode extends GraphElement { type: string }
export interface GraphEdge extends GraphElement { fromNode: string; toNode: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }
export type FilterOperator = 'exists' | 'missing' | 'equals' | 'not-equals' | 'contains' | 'text-contains' | 'gt' | 'gte' | 'lt' | 'lte'
export interface Condition {
  kind: 'condition'
  scope: 'properties' | 'native'
  path: (string | number)[]
  operator: FilterOperator
  value?: PropertyValue
}
export interface FilterGroup { kind: 'all' | 'any' | 'none'; conditions: Predicate[] }
export type Predicate = Condition | FilterGroup
export interface SavedView { id: string; name: string; mode: 'nodes' | 'edges'; nodes?: Predicate; edges?: Predicate }
export type SchemaFieldType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object'
export interface SchemaIssue { key: string; message: string }
export interface SchemaField {
  key: string; type: SchemaFieldType; description?: string
  required?: boolean; nullable?: boolean; default?: PropertyValue; options?: PropertyValue[]
  [key: string]: unknown
}
export interface ElementSchema { fields: SchemaField[]; allowAdditional: boolean; [key: string]: unknown }
export interface CanvasPropertySchema { version: 1; nodes: ElementSchema; edges: ElementSchema; [key: string]: unknown }
export interface RelationshipRule {
  id: string; name?: string; from: string[]; to: string[]; relations: string[]
  [key: string]: unknown
}
export interface RelationshipGuidance {
  version: 1; nodeTypeKey: string; edgeTypeKey: string; rules: RelationshipRule[]
  [key: string]: unknown
}
export interface RelationChoice { type: string; ruleIds: string[]; ruleNames: string[] }
export interface GraphConfiguration { version: 1; views: SavedView[]; schema?: CanvasPropertySchema; relationships?: RelationshipGuidance }
export interface Visibility { nodes: Set<string>; edges: Set<string> }
// Null denotes malformed property YAML. An empty mapping denotes no properties.
export type PropertyLookup = (element: GraphElement) => PropertyMap | null
