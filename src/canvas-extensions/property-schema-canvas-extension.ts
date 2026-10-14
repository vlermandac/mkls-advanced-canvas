// Authored by Codex (LLM agent). Undoable canvas schema commands; no automatic migration.
import { Modal, Notice, Setting } from 'obsidian'
import CanvasExtension from './canvas-extension'
import CanvasHelper from '../utils/canvas-helper'
import type { Canvas, CanvasNode, CanvasEdge } from '../@types/Canvas'
import type { CanvasPropertySchema, GraphConfiguration } from '../property-graph/types'
import { schemaFor, validateSchema, applySchemaDefaults, validateElementProperties } from '../property-graph/schema'
import SchemaModal from '../property-graph/schema-modal'
import { canvasTransaction } from '../property-graph/transaction'
import { parseProperties } from '../property-graph/properties'
import PortalsCanvasExtension from './portals-canvas-extension'

export default class PropertySchemaCanvasExtension extends CanvasExtension {
  isEnabled() { return true }
  init(): void {
    this.plugin.addCommand({ id: 'edit-property-schema', name: 'Edit canvas node and edge property schema', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !canvas.readonly, canvas => this.openEditor(canvas)) })
    this.plugin.addCommand({ id: 'apply-property-schema-defaults', name: 'Apply schema defaults to selected nodes and edges', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !canvas.readonly && canvas.selection.size > 0 && canvas.metadata?.propertyGraph?.schema !== undefined, canvas => this.applyDefaults(canvas)) })
  }
  private config(canvas: Canvas): GraphConfiguration | undefined {
    const config = canvas.metadata.propertyGraph
    if (config !== undefined && (config?.version !== 1 || !Array.isArray(config.views))) throw Error('Unsupported property graph configuration; original data is preserved')
    return config
  }
  openEditor(canvas: Canvas): void {
    try {
      const config = this.config(canvas), revision = JSON.stringify(config?.schema), file = canvas.view.file.path
      const checkRevision = () => {
        if (canvas.readonly || canvas.view.file.path !== file || JSON.stringify(this.config(canvas)?.schema) !== revision) throw Error('The canvas or schema changed. Keep this editor open to copy your fields, then reopen the current schema.')
      }
      let current: CanvasPropertySchema | undefined
      if (config?.schema !== undefined) {
        try { current = validateSchema(config.schema) } catch (error) {
          // Show unsupported data without offering a destructive schema rewrite.
          const modal = new Modal(this.plugin.app); modal.titleEl.setText('Canvas schema is read-only')
          modal.contentEl.createEl('p', { text: String(error instanceof Error ? error.message : error) })
          const source = modal.contentEl.createEl('textarea', { cls: 'mkls-source-editor', attr: { 'aria-label': 'Stored property schema' } })
          source.value = JSON.stringify(config.schema, null, 2); source.readOnly = true
          new Setting(modal.contentEl).addButton(button => button.setButtonText('Close').onClick(() => modal.close())); modal.open(); return
        }
      }
      new SchemaModal(this.plugin.app, current, schema => {
        checkRevision()
        canvasTransaction(canvas, () => { const previous = this.config(canvas); canvas.metadata.propertyGraph = { ...previous, version: 1, views: previous?.views ?? [], schema } }, true, true)
        new Notice('Canvas schema saved. Existing properties are unchanged.')
      }, current ? () => {
        checkRevision()
        canvasTransaction(canvas, () => { const next = { ...this.config(canvas)! }; delete next.schema; canvas.metadata.propertyGraph = next }, true, true)
        new Notice('Schema removed. Element properties and saved views are kept.')
      } : undefined).open()
    } catch (error) { new Notice(String(error instanceof Error ? error.message : error)) }
  }
  private applyDefaults(canvas: Canvas): void {
    try {
      this.config(canvas)
      const changes: { element: CanvasNode | CanvasEdge; yaml: string }[] = []
      for (const element of canvas.selection as Set<CanvasNode | CanvasEdge>) {
        if (PortalsCanvasExtension.isPortalElement(element.id)) throw Error('Select local elements; portal projections are read-only')
        const data = element.getData(), kind = 'from' in element ? 'edges' : 'nodes'
        const selected = schemaFor(canvas.metadata.propertyGraph, kind)
        if (selected.status !== 'valid') throw Error(selected.error ?? 'No canvas schema is defined')
        if (data.propertyGraph !== undefined && (data.propertyGraph?.version !== 1 || typeof data.propertyGraph?.yaml !== 'string')) throw Error(`Unsupported properties on ${data.id}; original data is preserved`)
        if (data.propertyGraph?.draft !== undefined) throw Error(`Resolve the unsaved property draft on ${data.id} before applying defaults`)
        const result = applySchemaDefaults(data.propertyGraph?.yaml ?? '', selected.definition!)
        if (!result.added.length) continue
        const values = parseProperties(result.yaml).values!
        const issues = validateElementProperties(canvas.metadata.propertyGraph, kind, values)
        if (issues.length) throw Error(`${data.id}: ${issues.map(issue => `${issue.key}: ${issue.message}`).join('; ')}. Complete the remaining fields in the property editor.`)
        changes.push({ element, yaml: result.yaml })
      }
      canvasTransaction(canvas, () => {
        for (const { element, yaml } of changes) element.setData({ ...element.getData(), propertyGraph: { ...element.getData().propertyGraph, version: 1, yaml } } as never)
      })
      new Notice(changes.length ? `Defaults applied to ${changes.length} selected element${changes.length === 1 ? '' : 's'}.` : 'No missing defaults to apply.')
    } catch (error) { new Notice(String(error instanceof Error ? error.message : error)) }
  }
}
