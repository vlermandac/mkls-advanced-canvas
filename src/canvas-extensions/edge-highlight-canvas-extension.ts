import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import { setTransition } from "src/utils/metadata-index-cache"
import CanvasExtension from "./canvas-extension"

export default class EdgeHighlightCanvasExtension  extends CanvasExtension {
  // Claude (LLM agent): remember the highlighted edges per canvas so a selection change touches
  // only previously and newly highlighted edges instead of every edge of the canvas.
  private highlightedEdges = new WeakMap<Canvas, Set<CanvasEdge>>()

  isEnabled() { return 'edgeHighlightEnabled' as const }

  init() {
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:selection-changed',
      (canvas: Canvas, oldSelection: Set<CanvasElement>, updateSelection: (update: () => void) => void) => this.onSelectionChanged(canvas, oldSelection)
    ))
  }

  private onSelectionChanged(canvas: Canvas, _oldSelection: Set<CanvasElement>) {
    const connectedEdgesToBeHighlighted = new Set(canvas.getSelectionData().nodes
      .flatMap(nodeData => [
        ...canvas.edgeFrom.get(canvas.nodes.get(nodeData.id)!) ?? [],
        ...(this.plugin.settings.getSetting("highlightIncomingEdges") ?
          canvas.edgeTo.get(canvas.nodes.get(nodeData.id)!) ?? [] :
          []
        )
      ]))

    // Selected edges are focused as well (same result as the former full scan)
    const focusedEdges = new Set<CanvasEdge>(connectedEdgesToBeHighlighted)
    for (const element of canvas.selection) {
      const edge = canvas.edges.get(element.id)
      if (edge === element) focusedEdges.add(edge)
    }

    const { on, off } = setTransition(this.highlightedEdges.get(canvas) ?? new Set<CanvasEdge>(), focusedEdges)
    for (const edge of off) this.setFocused(edge, false)
    for (const edge of on) this.setFocused(edge, true)
    this.highlightedEdges.set(canvas, focusedEdges)
  }

  private setFocused(edge: CanvasEdge, isFocused: boolean) {
    edge.lineGroupEl.classList.toggle("is-focused", isFocused)
    edge.lineEndGroupEl?.classList?.toggle("is-focused", isFocused)
    edge.labelElement?.textareaEl?.classList?.toggle("is-focused", isFocused)
  }
}
