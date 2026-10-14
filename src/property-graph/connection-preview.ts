// Authored by Codex (LLM agent). Runtime-only new-connection previews never become graph records.
import type { Canvas, CanvasEdge } from '../@types/Canvas'
const previews = new WeakMap<Canvas, Set<CanvasEdge>>()
const awaitingTarget = new WeakSet<CanvasEdge>()
export function markConnectionPreview(edge: CanvasEdge, preview: boolean): void {
  let set = previews.get(edge.canvas)
  if (preview) { if (!set) previews.set(edge.canvas, set = new Set()); set.add(edge) }
  else { set?.delete(edge); awaitingTarget.delete(edge); if (!set?.size) previews.delete(edge.canvas) }
}
export function isConnectionPreview(edge: CanvasEdge): boolean { return previews.get(edge.canvas)?.has(edge) === true }
export function connectionPreviews(canvas: Canvas): ReadonlySet<CanvasEdge> | undefined { return previews.get(canvas) }
export function awaitConnectionTarget(edge: CanvasEdge): void { awaitingTarget.add(edge) }
export function hasConnectionTarget(edge: CanvasEdge): boolean {
  return edge.canvas.nodes.get(edge.from.node.id) === edge.from.node && edge.canvas.nodes.get(edge.to.node.id) === edge.to.node
}
export function readyConnectionPreviews(canvas: Canvas): CanvasEdge[] {
  return [...previews.get(canvas) ?? []].filter(edge => awaitingTarget.has(edge) && hasConnectionTarget(edge))
}
