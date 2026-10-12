// Authored by Codex (LLM agent). Normalize transient upstream projections before unload.
import type { CanvasData, CanvasFileNodeData, CanvasGroupNodeData } from '../@types/AdvancedJsonCanvas'
const projected = (id: string) => id.startsWith('acportal||')
function transient(data: CanvasData): boolean {
  return data.nodes.some(node => projected(node.id) || (node as CanvasGroupNodeData).collapsedData !== undefined || (node as CanvasFileNodeData).isPortalLoaded !== undefined) || data.edges.some(edge => projected(edge.id) || projected(edge.fromNode) || projected(edge.toNode))
}
export function canonicalHistory(data: CanvasData, transform: (copy: CanvasData) => void): CanvasData {
  if (!transient(data)) return data
  const copy: CanvasData = { ...data, nodes: data.nodes, edges: data.edges }
  for (let depth = 0; depth < 100; depth++) {
    copy.nodes = copy.nodes.map(node => {
      const file = node as CanvasFileNodeData
      return { ...node, ...(Array.isArray(file.interdimensionalEdges) ? { interdimensionalEdges: file.interdimensionalEdges.slice() } : {}) }
    })
    copy.edges = copy.edges.map(edge => ({ ...edge }))
    transform(copy)
    if (!transient(copy)) return copy
  }
  throw Error('Canvas projection nesting exceeds 100 levels or could not be normalized')
}
