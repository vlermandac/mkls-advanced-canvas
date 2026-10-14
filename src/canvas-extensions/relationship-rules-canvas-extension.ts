// Authored by Codex (LLM agent). Optional endpoint guidance and atomic typed edge creation.
import { Modal, Notice, Setting } from 'obsidian'
import type { Canvas, CanvasEdge, CanvasNode } from '../@types/Canvas'
import type { CanvasEdgeData } from '../@types/AdvancedJsonCanvas'
import type { GraphElement, GraphConfiguration, RelationshipGuidance } from '../property-graph/types'
import CanvasExtension from './canvas-extension'
import CanvasHelper from '../utils/canvas-helper'
import PortalsCanvasExtension from './portals-canvas-extension'
import { relationshipGuidance, relationChoices, validateRelationshipGuidance } from '../property-graph/relationships'
import { schemaFor, applySchemaDefaults, validateElementProperties } from '../property-graph/schema'
import { parseProperties } from '../property-graph/properties'
import { sourceRevision } from '../property-graph/drafts'
import { setProperty } from '../property-graph/yaml-edit'
import { canvasTransaction } from '../property-graph/transaction'
import RelationRulesModal from '../property-graph/relation-rules-modal'
import { showRelationChoices } from '../property-graph/relation-choice-menu'

interface Pending { cancel: () => void; close?: () => void }
const asElement = (node: CanvasNode): GraphElement => node.getData() as unknown as GraphElement
const rulesRevision = (canvas: Canvas): string => JSON.stringify([canvas.metadata?.propertyGraph?.version, canvas.metadata?.propertyGraph?.relationships])
const creationRevision = (canvas: Canvas): string => JSON.stringify([canvas.metadata?.propertyGraph?.version, canvas.metadata?.propertyGraph?.relationships, canvas.metadata?.propertyGraph?.schema])

export default class RelationshipRulesCanvasExtension extends CanvasExtension {
  private pending = new Map<Canvas, Pending>()
  private unloading = false
  isEnabled() { return true }
  prepareUnload(): void { this.unloading = true; for (const pending of [...this.pending.values()]) pending.cancel() }
  init(): void {
    this.plugin.registerEvent(this.plugin.app.workspace.on('advanced-canvas:new-connection-drop:before', (canvas, edge, event, control) => this.onDrop(canvas, edge, event, control)))
    this.plugin.registerEvent(this.plugin.app.workspace.on('advanced-canvas:canvas-view-unloaded:before', view => this.pending.get(view.canvas)?.cancel()))
    this.plugin.registerEvent(this.plugin.app.workspace.on('advanced-canvas:data-loaded:before', (canvas, _data, _setData, clear) => { if (clear !== false) this.pending.get(canvas)?.cancel() }))
    this.plugin.register(() => this.prepareUnload())
    this.plugin.addCommand({ id: 'edit-relationship-rules', name: 'Edit canvas relationship rules', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !canvas.readonly, canvas => this.openEditor(canvas)) })
  }
  private config(canvas: Canvas): GraphConfiguration | undefined {
    const config = canvas.metadata?.propertyGraph
    if (config !== undefined && (config?.version !== 1 || !Array.isArray(config.views))) throw Error('Unsupported property graph configuration; original data is preserved')
    return config
  }
  openEditor(canvas: Canvas): void {
    try {
      const config = this.config(canvas), revision = rulesRevision(canvas), file = canvas.view.file.path
      let current: RelationshipGuidance | undefined
      if (config?.relationships !== undefined) {
        try { current = validateRelationshipGuidance(config.relationships) } catch (error) {
          const modal = new Modal(this.plugin.app); modal.titleEl.setText('Relationship rules are read-only')
          modal.contentEl.createEl('p', { text: String(error instanceof Error ? error.message : error) })
          const source = modal.contentEl.createEl('textarea', { cls: 'mkls-source-editor', attr: { 'aria-label': 'Stored relationship rules' } })
          source.value = JSON.stringify(config.relationships, null, 2); source.readOnly = true
          new Setting(modal.contentEl).addButton(button => button.setButtonText('Close').onClick(() => modal.close())); modal.open(); return
        }
      }
      const check = () => {
        if (canvas.readonly || canvas.view.file.path !== file || rulesRevision(canvas) !== revision) throw Error('The canvas or rules changed. Keep this editor open to copy your rules, then reopen the current version.')
        this.config(canvas)
      }
      new RelationRulesModal(this.plugin.app, current, value => {
        check(); const relationships = validateRelationshipGuidance(value)
        canvasTransaction(canvas, () => { const previous = this.config(canvas); canvas.metadata.propertyGraph = { ...previous, version: 1, views: previous?.views ?? [], relationships } }, true, true)
        new Notice('Relationship guidance saved. Existing edges are unchanged.')
      }, current ? () => {
        check(); canvasTransaction(canvas, () => { const next = { ...this.config(canvas)! }; delete next.relationships; canvas.metadata.propertyGraph = next }, true, true)
        new Notice('Relationship guidance removed. Existing edges are unchanged.')
      } : undefined, (key, kind) => {
        const field = schemaFor(canvas.metadata?.propertyGraph, kind).definition?.fields.find(field => field.key === key)
        return [...new Set((field?.options ?? []).flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) && value.every(item => typeof item === 'string') ? value : []))]
      }).open()
    } catch (error) { new Notice(String(error instanceof Error ? error.message : error)) }
  }
  private onDrop(canvas: Canvas, edge: CanvasEdge, event: PointerEvent, control: { handled: boolean }): void {
    if (control.handled || this.unloading || canvas.readonly) return
    const source = edge.from.node, target = edge.to.node
    if (PortalsCanvasExtension.isPortalElement(source.id) || PortalsCanvasExtension.isPortalElement(target.id)) return
    if (canvas.nodes.get(source.id) !== source || canvas.nodes.get(target.id) !== target) return
    if (!relationChoices(canvas.metadata?.propertyGraph, asElement(source), asElement(target)).length) return
    // Future schemas cannot be rewritten by our current property writer.
    if (schemaFor(canvas.metadata?.propertyGraph, 'edges').status === 'unsupported') return
    control.handled = true
    this.pending.get(canvas)?.cancel()
    const file = canvas.view.file.path
    const pending: Pending = { cancel: () => {
      if (this.pending.get(canvas) !== pending) return
      this.pending.delete(canvas); pending.close?.()
      if (canvas.edges.get(edge.id) === edge) canvas.removeEdge(edge)
      canvas.markViewportChanged()
    } }
    this.pending.set(canvas, pending)
    // Complete the native pointer-up and floating-side handlers before retaining
    // the candidate data. Native save/history was intercepted; no graph record
    // is saved while the user chooses a type.
    queueMicrotask(() => {
      if (this.pending.get(canvas) !== pending) return
      try {
        if (canvas.view.file?.path !== file || canvas.edges.get(edge.id) !== edge || canvas.readonly) { pending.cancel(); return }
        const data = JSON.parse(JSON.stringify(edge.getData())) as CanvasEdgeData
        if (data.fromNode !== source.id || data.toNode !== target.id) { pending.cancel(); return }
        const revision = creationRevision(canvas), sourceVersion = sourceRevision(asElement(source)), targetVersion = sourceRevision(asElement(target))
        const choices = relationChoices(canvas.metadata?.propertyGraph, asElement(source), asElement(target))
        canvas.removeEdge(edge); canvas.markViewportChanged()
        if (!choices.length) { pending.cancel(); return }
        pending.close = showRelationChoices(this.plugin.app, { canvas, source, target, choices, position: { x: event.clientX, y: event.clientY }, cancel: pending.cancel, choose: type => {
          if (this.pending.get(canvas) !== pending) return
          this.pending.delete(canvas)
          try {
            if (this.unloading || canvas.readonly || canvas.view.file?.path !== file || canvas.nodes.get(source.id) !== source || canvas.nodes.get(target.id) !== target || canvas.edges.has(data.id) || creationRevision(canvas) !== revision || sourceRevision(asElement(source)) !== sourceVersion || sourceRevision(asElement(target)) !== targetVersion) throw Error('The canvas, endpoints, schema or rules changed. Draw the connection again.')
            if (type !== undefined && !choices.some(choice => choice.type === type)) throw Error('Unknown relationship choice')
            this.create(canvas, data, type)
          } catch (error) { new Notice(String(error instanceof Error ? error.message : error)) }
        } })
      } catch (error) { pending.cancel(); new Notice('Unable to offer relationship types: ' + String(error instanceof Error ? error.message : error)) }
    })
  }
  private create(canvas: Canvas, preview: CanvasEdgeData, type: string | undefined): void {
    let data = preview, issues: string[] = []
    if (type !== undefined) {
      const guidance = relationshipGuidance(canvas.metadata?.propertyGraph).value!
      const record = preview.propertyGraph
      if (record !== undefined && (record?.version !== 1 || typeof record?.yaml !== 'string')) throw Error('Unsupported edge properties; reconnect without a type or update the property format')
      let yaml = setProperty(record?.draft ?? record?.yaml ?? '', guidance.edgeTypeKey, type)
      const schema = schemaFor(canvas.metadata?.propertyGraph, 'edges')
      if (schema.status === 'unsupported') throw Error(schema.error)
      if (schema.definition) yaml = applySchemaDefaults(yaml, schema.definition).yaml
      const parsed = parseProperties(yaml)
      if (!parsed.values) throw Error(parsed.errors.map(error => error.message).join('; '))
      issues = validateElementProperties(canvas.metadata?.propertyGraph, 'edges', parsed.values).map(issue => issue.key ? `${issue.key}: ${issue.message}` : issue.message)
      const propertyGraph = { ...record, version: 1 as const, yaml: issues.length ? record?.yaml ?? '' : yaml }
      if (issues.length) propertyGraph.draft = yaml
      else delete propertyGraph.draft
      data = { ...preview, label: type, propertyGraph }
    }
    canvasTransaction(canvas, () => canvas.importData({ nodes: [], edges: [data] }, false))
    const created = canvas.edges.get(data.id)
    if (created) canvas.selectOnly(created)
    canvas.wrapperEl.focus()
    if (issues.length) new Notice('Relation created with draft properties. Complete them in the Properties section: ' + issues.join('; '))
  }
}
