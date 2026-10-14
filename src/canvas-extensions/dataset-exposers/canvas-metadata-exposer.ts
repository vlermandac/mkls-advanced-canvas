import { Canvas } from "src/@types/Canvas"
import CanvasExtension from "../canvas-extension"

export default class CanvasMetadataExposerExtension extends CanvasExtension {
  isEnabled() { return true }

  init() {
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:canvas-metadata-changed',
      (canvas: Canvas) => this.updateExposedSettings(canvas)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:canvas-changed',
      (canvas: Canvas) => this.updateExposedSettings(canvas)
    ))
  }

  // Claude (LLM agent): track the exposed start node per canvas so metadata changes update at
  // most the previous and the new start node instead of every node.
  private exposedStartNodeIds = new WeakMap<Canvas, string | undefined>()

  private updateExposedSettings(canvas: Canvas) {
    // Expose start node
    const startNodeId = canvas.metadata?.['startNode']
    const previousStartNodeId = this.exposedStartNodeIds.get(canvas)

    if (previousStartNodeId !== undefined && previousStartNodeId !== startNodeId) {
      const previousNode = canvas.nodes.get(previousStartNodeId)
      if (previousNode) delete previousNode.nodeEl.dataset.isStartNode
    }

    // Re-applied even when unchanged: the node element may have been re-created by a reload
    const startNode = startNodeId !== undefined ? canvas.nodes.get(startNodeId) : undefined
    if (startNode) startNode.nodeEl.dataset.isStartNode = 'true'

    this.exposedStartNodeIds.set(canvas, startNodeId)
  }
}