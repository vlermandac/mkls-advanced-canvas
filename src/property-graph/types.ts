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
export interface GraphConfiguration { version: 1; views: SavedView[] }
export interface Visibility { nodes: Set<string>; edges: Set<string> }
// Null denotes malformed property YAML. An empty mapping denotes no properties.
export type PropertyLookup = (element: GraphElement) => PropertyMap | null
