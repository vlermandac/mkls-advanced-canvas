// Authored by Codex (LLM agent). Per-element YAML and non-destructive saved views.
import { Modal, Notice, Setting } from 'obsidian'
import { around } from 'monkey-around'
import type { Canvas, CanvasElement, CanvasNode, CanvasEdge, CanvasView, BBox, Position } from '../@types/Canvas'
import type { CanvasData, CanvasNodeData, CanvasEdgeData } from '../@types/AdvancedJsonCanvas'
import type AdvancedCanvasPlugin from '../main'
import CanvasExtension from './canvas-extension'
import CanvasHelper from '../utils/canvas-helper'
import { PropertyService, parseProperties, editingSource, splitEditingSource } from '../property-graph/properties'
import { ViewIndex, validateView, VisibilityDelta } from '../property-graph/filter'
import type { GraphData, GraphElement, GraphNode, GraphEdge, SavedView, Visibility } from '../property-graph/types'
import { canvasTransaction } from '../property-graph/transaction'
import Patcher from '../patchers/patcher'
import { DraftStore, SourceDraft, sourceRevision } from '../property-graph/drafts'
import PortalsCanvasExtension from './portals-canvas-extension'
import { canvasImports } from '../utils/import-coordinator'

type Element = CanvasNode | CanvasEdge
type Data = CanvasNodeData | CanvasEdgeData
interface State {
  canvas: Canvas; service: PropertyService; active?: string; visible: Visibility
  frame?: number; dispose: () => void
  panels: Map<Element, HTMLTextAreaElement>; labels: WeakSet<object>
  labelDisposers: Map<CanvasEdge, () => void>
  endpoints: Map<string, string>
  portalElements: Map<string, Set<Element>>
  index?: ViewIndex; reload: boolean; dirtyNodes: Set<string>; dirtyEdges: Set<string>
  indexKey?: string; appliedActive?: string
  controlsKey?: string
  file: string
}
interface NativeVisibilityCanvas extends Canvas {
  getIntersectingNodes(bbox: BBox): CanvasNode[]
  getIntersectingEdges(bbox: BBox): CanvasEdge[]
  hitTestNode(point: Position, margin?: number): CanvasNode | null
  selectAll(elements?: CanvasElement[]): void
}

const asElement = (data: Data) => data as unknown as GraphElement
const isEdge = (data: Data): data is CanvasEdgeData => 'fromNode' in data
const yamlOf = (data: Data): string => typeof data.propertyGraph?.draft === 'string' ? data.propertyGraph.draft : typeof data.propertyGraph?.yaml === 'string' ? data.propertyGraph.yaml : ''
const writableRecord = (data: Data): boolean => data.propertyGraph === undefined || (data.propertyGraph?.version === 1 && typeof data.propertyGraph?.yaml === 'string')
function bodyOf(data: Data): string {
  if (isEdge(data)) return data.label ?? ''
  if (data.type === 'text') return (data as CanvasNodeData & { text: string }).text
  if (data.type === 'group') return (data as CanvasNodeData & { label?: string }).label ?? ''
  return ''
}

class SourceModal extends Modal {
  private source: HTMLTextAreaElement | undefined
  private saved = false
  private initialSource = ''
  private revision: string
  private file: string
  constructor(app: AdvancedCanvasPlugin['app'], private element: Element, private commit: (data: Data, history?: boolean) => void, private drafts: DraftStore, private recovered?: SourceDraft) {
    super(app); this.file = element.canvas.view.file.path; this.revision = sourceRevision(asElement(element.getData()))
  }
  private current(): Element | undefined {
    if (this.element.canvas.view.file.path !== this.file) return undefined
    return isEdge(this.element.getData()) ? this.element.canvas.edges.get(this.element.id) : this.element.canvas.nodes.get(this.element.id)
  }
  onOpen(): void {
    const data = this.element.getData()
    this.titleEl.setText(isEdge(data) ? 'Edit edge source' : 'Edit node source')
    this.contentEl.createEl('p', { text: 'Frontmatter belongs to this canvas element. It is hidden in rendered content.' })
    this.source = this.contentEl.createEl('textarea', { cls: 'mkls-source-editor' })
    const initial = editingSource(yamlOf(data), bodyOf(data))
    const recoveredSource = this.recovered?.kind === 'yaml' ? editingSource(this.recovered.source, bodyOf(data)) : this.recovered?.source
    this.source.value = this.recovered?.revision === this.revision ? recoveredSource! : initial
    this.initialSource = this.source.value
    if (this.recovered?.revision === this.revision) this.contentEl.createEl('p', { text: 'Showing a recovered, unsaved draft.' })
    if (this.recovered && this.recovered.revision !== this.revision && this.recovered.source !== initial) {
      this.contentEl.createEl('p', { text: 'An earlier draft is retained in plugin recovery storage. This editor shows the current element because its content changed.' })
      new Setting(this.contentEl).addButton(button => button.setButtonText('Load retained draft').onClick(() => { this.source!.value = recoveredSource! }))
    }
    const message = this.contentEl.createEl('p')
    new Setting(this.contentEl).addButton(button => button.setButtonText('Save').setCta().onClick(() => {
      try {
        const split = splitEditingSource(this.source!.value)
        const parsed = parseProperties(split.yaml)
        if (parsed.errors.length) throw new Error(parsed.errors.map(e => `${e.line}:${e.column} ${e.message}`).join('\n'))
        const current = this.current()
        if (!current || sourceRevision(asElement(current.getData())) !== this.revision) throw Error('The canvas or element changed. Close to retain this draft, then reopen the current element.')
        if (current.canvas.readonly || PortalsCanvasExtension.isPortalElement(current.id)) throw Error('This element is read-only; edit the source canvas instead')
        if (!writableRecord(current.getData())) throw Error('Unsupported property record; original data is preserved')
        const record = { ...current.getData().propertyGraph, version: 1 as const, yaml: split.yaml }; delete record.draft
        const next: Data = { ...current.getData(), propertyGraph: record }
        if (isEdge(next)) next.label = split.body
        else if (next.type === 'text') Object.assign(next, { text: split.body })
        else if (next.type === 'group') Object.assign(next, { label: split.body })
        else if (split.body.trim()) throw Error('File/link nodes accept frontmatter here; edit linked content in its own file')
        this.commit(next); this.saved = true
        void this.drafts.consume(this.file, this.element.id).catch(error => new Notice('Saved; recovery marker failed: ' + String(error)))
        this.close()
      } catch (error) { message.setText(String(error instanceof Error ? error.message : error)) }
    }))
  }
  onClose(): void {
    if (!this.saved && this.source && this.source.value !== this.initialSource) {
      void this.drafts.save({ file: this.file, id: this.element.id, source: this.source.value, revision: this.revision, savedAt: new Date().toISOString() }).catch(error => new Notice(`Draft retained in memory; recovery write failed: ${String(error)}`))
    }
    this.contentEl.empty()
  }
}

class ViewModal extends Modal {
  constructor(app: AdvancedCanvasPlugin['app'], private current: SavedView | undefined, private save: (view: SavedView) => void) { super(app) }
  onOpen(): void {
    this.titleEl.setText(this.current ? 'Edit view' : 'Create view')
    this.contentEl.createEl('p', { text: 'Filter node and edge properties. Switching a view preserves the complete graph.' })
    const example: SavedView = this.current ?? { id: crypto.randomUUID(), name: 'New view', mode: 'nodes', nodes: { kind: 'all', conditions: [] }, edges: { kind: 'all', conditions: [] } }
    const name = new Setting(this.contentEl).setName('Name')
    name.addText(input => input.setValue(example.name).onChange(value => { example.name = value }))
    new Setting(this.contentEl).setName('Match').addDropdown(input => input.addOption('nodes', 'Nodes and connecting edges').addOption('edges', 'Edges and their endpoints').setValue(example.mode).onChange(value => { example.mode = value as 'nodes' | 'edges' }))
    const predicateEditors: { nodes: HTMLTextAreaElement; edges: HTMLTextAreaElement } = {} as typeof predicateEditors
    for (const kind of ['nodes', 'edges'] as const) {
      this.contentEl.createEl('h3', { text: kind === 'nodes' ? 'Node filter' : 'Edge filter' })
      this.contentEl.createEl('p', { text: 'Example: {"kind":"condition","scope":"properties","path":["status"],"operator":"equals","value":"accepted"}. Use all/any/none groups with conditions for combinations.' })
      const text = this.contentEl.createEl('textarea', { cls: 'mkls-filter-editor' })
      text.value = JSON.stringify(example[kind] ?? { kind: 'all', conditions: [] }, null, 2); predicateEditors[kind] = text
    }
    const errors = this.contentEl.createEl('p')
    new Setting(this.contentEl).addButton(button => button.setButtonText('Save view').setCta().onClick(() => {
      try {
        const view = validateView({ ...example, nodes: JSON.parse(predicateEditors.nodes.value) as unknown, edges: JSON.parse(predicateEditors.edges.value) as unknown })
        this.save(view); this.close()
      } catch (error) { errors.setText(String(error instanceof Error ? error.message : error)) }
    }))
  }
}

export default class PropertyGraphCanvasExtension extends CanvasExtension {
  private states = new Map<Canvas, State>()
  private draftStore!: DraftStore
  private unloading = false
  isEnabled() { return true }
  prepareUnload(): void { this.unloading = true; for (const state of [...this.states.values()]) this.detach(state.canvas.view) }
  init(): void {
    // Store construction is deferred below with other subclass state.
    const events = this.plugin.app.workspace
    this.plugin.registerEvent(events.on('advanced-canvas:canvas-changed', canvas => { this.attach(canvas); this.schedule(canvas); this.controls(canvas) }))
    this.plugin.registerEvent(events.on('advanced-canvas:node-added', (canvas, node) => { this.attach(canvas); this.schedule(canvas, node); this.editing(canvas, node, node.isEditing) }))
    this.plugin.registerEvent(events.on('advanced-canvas:edge-added', (canvas, edge) => { this.attach(canvas); this.hookLabel(canvas, edge); this.schedule(canvas, edge) }))
    this.plugin.registerEvent(events.on('advanced-canvas:node-changed', (canvas, node) => { this.schedule(canvas, node); this.editing(canvas, node, node.isEditing) }))
    this.plugin.registerEvent(events.on('advanced-canvas:node-text-content-changed', (canvas, node) => this.schedule(canvas, node)))
    this.plugin.registerEvent(events.on('advanced-canvas:node-moved', (canvas, node) => this.schedule(canvas, node, false)))
    this.plugin.registerEvent(events.on('advanced-canvas:node-resized', (canvas, node) => this.schedule(canvas, node, false)))
    this.plugin.registerEvent(events.on('advanced-canvas:node-editing-state-changed', (canvas, node, editing) => this.editing(canvas, node, editing)))
    this.plugin.registerEvent(events.on('advanced-canvas:node-rendered', (canvas, node) => this.editing(canvas, node, node.isEditing)))
    this.plugin.registerEvent(events.on('advanced-canvas:edge-changed', (canvas, edge) => {
      this.hookLabel(canvas, edge); const state = this.states.get(canvas); this.applyElement(state, edge)
      const ends = edge.from.node.id + '\u0000' + edge.to.node.id
      if (state && state.endpoints.get(edge.id) !== ends) { state.endpoints.set(edge.id, ends); this.schedule(canvas, edge) }
    }))
    this.plugin.registerEvent(events.on('advanced-canvas:edge-data-changed', (canvas, edge) => this.schedule(canvas, edge)))
    this.plugin.registerEvent(events.on('advanced-canvas:canvas-metadata-changed', canvas => { this.schedule(canvas, undefined, false); this.controls(canvas) }))
    this.plugin.registerEvent(events.on('advanced-canvas:undo', canvas => this.schedule(canvas)))
    this.plugin.registerEvent(events.on('advanced-canvas:redo', canvas => this.schedule(canvas)))
    this.plugin.registerEvent(events.on('advanced-canvas:data-loaded:before', (canvas, data, _setData, clearCanvas) => this.beforeReload(canvas, data, clearCanvas)))
    this.plugin.registerEvent(events.on('advanced-canvas:data-loaded:after', canvas => { this.schedule(canvas); this.controls(canvas); for (const edge of canvas.edges.values()) this.hookLabel(canvas, edge) }))
    this.plugin.registerEvent(events.on('advanced-canvas:node-removed', (canvas, node) => {
      const state = this.states.get(canvas); state?.panels.get(node)?.parentElement?.remove(); state?.panels.delete(node)
      state?.service.delete(node.id); this.schedule(canvas, node, false)
      this.removeProjection(state, node)
    }))
    this.plugin.registerEvent(events.on('advanced-canvas:edge-removed', (canvas, edge) => {
      const state = this.states.get(canvas); state?.labelDisposers.get(edge)?.(); state?.labelDisposers.delete(edge)
      state?.panels.get(edge)?.parentElement?.remove(); state?.panels.delete(edge); state?.endpoints.delete(edge.id)
      state?.service.delete(edge.id); this.schedule(canvas, edge, false)
      this.removeProjection(state, edge)
    }))
    this.plugin.registerEvent(events.on('advanced-canvas:canvas-view-unloaded:before', view => this.detach(view)))
    this.plugin.register(() => { for (const state of [...this.states.values()]) this.detach(state.canvas.view) })
    this.plugin.addCommand({ id: 'edit-element-properties', name: 'Edit selected node or edge frontmatter', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !canvas.readonly && canvas.selection.size === 1, canvas => this.openSource(canvas)) })
    this.plugin.addCommand({ id: 'create-property-view', name: 'Create property view', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !canvas.readonly, canvas => this.viewEditor(canvas)) })
    this.plugin.addCommand({ id: 'show-all-properties', name: 'Show complete canvas', checkCallback: CanvasHelper.canvasCommand(this.plugin, () => true, canvas => this.setView(canvas)) })
    this.plugin.addCommand({ id: 'edit-property-view', name: 'Edit current property view', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !!this.states.get(canvas)?.active && !canvas.readonly, canvas => {
      const current = this.views(canvas).find(view => view.id === this.states.get(canvas)?.active)
      this.viewEditor(canvas, current)
    }) })
    this.plugin.addCommand({ id: 'duplicate-property-view', name: 'Duplicate current property view', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !!this.states.get(canvas)?.active && !canvas.readonly, canvas => {
      const current = this.views(canvas).find(view => view.id === this.states.get(canvas)?.active)
      if (current) this.viewEditor(canvas, { ...current, id: crypto.randomUUID(), name: current.name + ' copy' })
    }) })
    this.plugin.addCommand({ id: 'export-property-view', name: 'Export current view as a new canvas', checkCallback: CanvasHelper.canvasCommand(this.plugin, () => true, async canvas => {
      const state = this.states.get(canvas)
      if (state?.active) this.refresh(state)
      const data = JSON.parse(JSON.stringify(canvas.getData())) as CanvasData
      if (state?.active) {
        data.nodes = data.nodes.filter(node => state.visible.nodes.has(node.id))
        data.edges = data.edges.filter(edge => state.visible.edges.has(edge.id))
      }
      const base = canvas.view.file.path.replace(/\.canvas$/, '')
      const path = base + '-view-' + Date.now() + '.canvas'
      try { await this.plugin.app.vault.create(path, JSON.stringify(data, null, 2)); new Notice('Exported ' + path) }
      catch (error) { new Notice('Unable to export view: ' + String(error)) }
    }) })
    this.plugin.addCommand({ id: 'delete-property-view', name: 'Delete current property view', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => !!this.states.get(canvas)?.active && !canvas.readonly, canvas => {
      const id = this.states.get(canvas)?.active
      if (!this.writableViews(canvas)) return
      canvasTransaction(canvas, () => { const config = canvas.metadata.propertyGraph!; canvas.metadata.propertyGraph = { ...config, version: 1, views: config.views.filter(view => view?.id !== id) } }, true, true)
      this.setView(canvas)
    }) })
    this.plugin.addCommand({ id: 'adopt-node-frontmatter', name: 'Adopt selected text node frontmatter as properties', checkCallback: CanvasHelper.canvasCommand(this.plugin, canvas => canvas.selection.size === 1 && !canvas.readonly, canvas => {
      const node = [...canvas.selection][0] as CanvasNode; const data = node.getData()
      if (data.type !== 'text') { new Notice('Select a text node'); return }
      try {
        const split = splitEditingSource(bodyOf(data)); const parsed = parseProperties(split.yaml)
        if (parsed.errors.length) throw Error(parsed.errors[0].message)
        if (data.propertyGraph !== undefined) throw Error('This node already has a property record; merge it explicitly in the source editor')
        canvasTransaction(canvas, () => node.setData({ ...data, propertyGraph: { version: 1, yaml: split.yaml }, text: split.body })); this.schedule(canvas)
      } catch (error) { new Notice(String(error instanceof Error ? error.message : error)) }
    }) })
    // CanvasExtension invokes init from its base constructor; wait until this
    // subclass's state fields are initialized before inspecting open canvases.
    queueMicrotask(() => {
      this.draftStore = new DraftStore(this.plugin.app.vault.adapter, this.plugin.manifest.dir + '/drafts')
      for (const canvas of this.plugin.getCanvases()) this.attach(canvas)
    })
  }
  private views(canvas: Canvas): SavedView[] {
    const config = canvas.metadata?.propertyGraph
    if (!config || config.version !== 1 || !Array.isArray(config.views)) return []
    return config.views.flatMap(view => { try { return [validateView(view)] } catch { return [] } })
  }
  private writableViews(canvas: Canvas): boolean {
    const config = canvas.metadata?.propertyGraph
    if (config !== undefined && (config?.version !== 1 || !Array.isArray(config?.views))) { new Notice('Unsupported saved-view data; original configuration is preserved'); return false }
    return true
  }
  private async openSource(canvas: Canvas): Promise<void> {
    const element = [...canvas.selection][0] as Element
    if (!element) return
    if (canvas.readonly || PortalsCanvasExtension.isPortalElement(element.id)) { new Notice('Edit properties in the source canvas; this projection is read-only'); return }
    const file = canvas.view.file.path
    const recovered = await this.draftStore.read(file, element.id)
    if (canvas.view.file?.path !== file || (isEdge(element.getData()) ? canvas.edges.get(element.id) : canvas.nodes.get(element.id)) !== element) return
    new SourceModal(this.plugin.app, element, data => {
      if (canvas.view.file.path !== file) throw Error('Canvas changed')
      const current = isEdge(data) ? canvas.edges.get(data.id) : canvas.nodes.get(data.id)
      if (!current) throw Error('Element no longer exists')
      canvasTransaction(canvas, () => current.setData(data as never)); this.schedule(canvas, current)
    }, this.draftStore, recovered).open()
  }
  private viewEditor(canvas: Canvas, current?: SavedView): void {
    const revision = JSON.stringify(canvas.metadata.propertyGraph), file = canvas.view.file.path
    new ViewModal(this.plugin.app, current, view => {
      if (canvas.readonly || canvas.view.file.path !== file || JSON.stringify(canvas.metadata.propertyGraph) !== revision) throw Error('The canvas or saved views changed. Keep this editor open to copy your filter, then reopen the current definition.')
      if (!this.saveView(canvas, view)) throw Error('Unsupported saved-view configuration; original data is preserved')
    }).open()
  }
  private saveView(canvas: Canvas, view: SavedView): boolean {
    if (!this.writableViews(canvas)) return false
    canvasTransaction(canvas, () => {
      const config = canvas.metadata.propertyGraph
      const previous = config?.views ?? []
      const record = { ...previous.find(item => item?.id === view.id), ...view }
      canvas.metadata.propertyGraph = { ...config, version: 1, views: [...previous.filter(item => item?.id !== view.id), record] }
    }, true, true); this.setView(canvas, view.id); this.controls(canvas); return true
  }
  private setView(canvas: Canvas, id?: string): void {
    this.attach(canvas); const state = this.states.get(canvas)!
    state.active = id; this.refresh(state); this.controls(canvas)
  }
  private controls(canvas: Canvas): void {
    const container = canvas.canvasControlsEl
    if (!container) return
    const key = JSON.stringify([this.views(canvas).map(view => [view.id, view.name]), this.states.get(canvas)?.active])
    const state = this.states.get(canvas)
    if (state?.controlsKey === key && container.querySelector('.mkls-view-select')) return
    if (state) state.controlsKey = key
    let select = container.querySelector<HTMLSelectElement>('.mkls-view-select')
    if (!select) {
      select = container.createEl('select', { cls: 'mkls-view-select', attr: { 'aria-label': 'Canvas property view' } })
      select.onchange = () => this.setView(canvas, select!.value || undefined)
    }
    select.replaceChildren()
    select.createEl('option', { text: 'All', value: '' })
    for (const view of this.views(canvas)) select.createEl('option', { text: view.name, value: view.id })
    select.value = this.states.get(canvas)?.active ?? ''
  }
  private attach(canvas: Canvas): void {
    if (this.unloading || !canvas || this.states.has(canvas)) return
    const native = canvas as NativeVisibilityCanvas
    const state: State = { canvas, service: new PropertyService(), visible: { nodes: new Set(), edges: new Set() }, panels: new Map(), labels: new WeakSet(), labelDisposers: new Map(), endpoints: new Map(), portalElements: new Map(), reload: true, dirtyNodes: new Set(), dirtyEdges: new Set(), file: canvas.view.file?.path ?? '', dispose: () => {} }
    this.states.set(canvas, state)
    const visible = (element: CanvasElement) => this.visible(state, element)
    const uninstall = around(native, {
      getIntersectingNodes: (next: NativeVisibilityCanvas['getIntersectingNodes']) => (bbox: BBox) => { const result = next.call(native, bbox) as CanvasNode[]; return state.active ? result.filter(visible) : result },
      getIntersectingEdges: (next: NativeVisibilityCanvas['getIntersectingEdges']) => (bbox: BBox) => { const result = next.call(native, bbox) as CanvasEdge[]; return state.active ? result.filter(visible) : result },
      selectAll: (next: NativeVisibilityCanvas['selectAll']) => (elements?: CanvasElement[]) => { next.call(native, state.active ? (elements ?? [...canvas.nodes.values()]).filter(visible) : elements) },
      hitTestNode: (next: NativeVisibilityCanvas['hitTestNode']) => (point: Position, margin?: number) => {
        const hit = next.call(native, point, margin) as CanvasNode | null
        if (!hit || visible(hit)) return hit
        const padding = margin ?? 0
        return native.getIntersectingNodes({ minX: point.x-padding, minY: point.y-padding, maxX: point.x+padding, maxY: point.y+padding }).sort((a, b) => b.zIndex - a.zIndex)[0] ?? null
      },
      zoomToFit: (next: Canvas['zoomToFit']) => () => {
        if (!state.active) { next.call(canvas); return }
        const nodes = [...canvas.nodes.values()].filter(visible)
        if (nodes.length) canvas.zoomToBbox(CanvasHelper.getBBox(nodes.map(node => node.getData())))
      },
      selectOnly: (next: Canvas['selectOnly']) => (element: CanvasElement) => {
        if (!visible(element)) { state.active = undefined; this.refresh(state); this.controls(canvas) }
        next.call(canvas, element)
      }
    })
    state.dispose = Patcher.registerUninstaller(this.plugin, uninstall)
    this.refresh(state); this.controls(canvas)
    for (const edge of canvas.edges.values()) this.hookLabel(canvas, edge)
  }
  private schedule(canvas: Canvas, element?: Element, reload = !element): void {
    const state = this.states.get(canvas)
    if (!state) return
    if (element && PortalsCanvasExtension.isPortalElement(element.id)) { this.applyElement(state, element); return }
    if (reload || (element && !('from' in element) && element.getData().type === 'group')) state.reload = true
    else if (element) ('from' in element ? state.dirtyEdges : state.dirtyNodes).add(element.id)
    if (!state.active) return
    if (state.frame !== undefined) return
    state.frame = canvas.canvasEl.win.requestAnimationFrame(() => { state.frame = undefined; this.refresh(state); this.controls(canvas) })
  }
  private refresh(state: State): void {
    const canvas = state.canvas
    const view = this.views(canvas).find(view => view.id === state.active)
    if (!view) state.active = undefined
    if (!state.active) {
      // Keep the already loaded index and accumulate dirty IDs while in All.
      // Returning to a saved view does not need another full model snapshot.
      for (const node of canvas.nodes.values()) this.applyElement(state, node)
      for (const edge of canvas.edges.values()) this.applyElement(state, edge)
      state.appliedActive = undefined
      canvas.markViewportChanged(); return
    }
    const key = JSON.stringify(view)
    let applyAll = state.appliedActive === undefined
    if (state.reload || !state.index) {
      state.index = new ViewIndex(view, element => state.service.get(element).values)
      state.index.load(canvas.getData() as unknown as GraphData)
      state.visible = state.index.visibility(); state.reload = false
      state.indexKey = key; applyAll = true
    } else {
      for (const id of state.dirtyNodes) {
        const node = canvas.nodes.get(id)
        this.applyDelta(state, node ? state.index.upsertNode(node.getData() as unknown as GraphNode) : state.index.removeNode(id))
      }
      for (const id of state.dirtyEdges) {
        const edge = canvas.edges.get(id)
        this.applyDelta(state, edge ? state.index.upsertEdge(edge.getData() as unknown as GraphEdge) : state.index.removeEdge(id))
      }
      if (state.indexKey !== key) { this.applyDelta(state, state.index.setView(view)); state.indexKey = key }
    }
    if (applyAll) {
      for (const node of canvas.nodes.values()) this.applyElement(state, node)
      for (const edge of canvas.edges.values()) this.applyElement(state, edge)
    }
    state.appliedActive = state.active
    state.dirtyNodes.clear(); state.dirtyEdges.clear()
    const hiddenSelected = [...canvas.selection].filter(item => isEdge(item.getData()) ? !state.visible.edges.has(item.id) : !state.visible.nodes.has(item.id))
    if (hiddenSelected.length) canvas.updateSelection(() => { for (const item of hiddenSelected) canvas.selection.delete(item) })
    canvas.markViewportChanged()
  }
  private applyDelta(state: State, delta: VisibilityDelta): void {
    for (const id of delta.shownNodes) state.visible.nodes.add(id)
    for (const id of delta.hiddenNodes) state.visible.nodes.delete(id)
    for (const id of delta.shownEdges) state.visible.edges.add(id)
    for (const id of delta.hiddenEdges) state.visible.edges.delete(id)
    for (const id of [...delta.shownNodes, ...delta.hiddenNodes]) { const node = state.canvas.nodes.get(id); if (node) this.applyElement(state, node) }
    for (const id of [...delta.shownEdges, ...delta.hiddenEdges]) { const edge = state.canvas.edges.get(id); if (edge) this.applyElement(state, edge) }
    for (const id of [...delta.shownNodes, ...delta.hiddenNodes]) for (const element of state.portalElements.get(id) ?? []) this.applyElement(state, element)
  }
  private visible(state: State, element: CanvasElement): boolean {
    if (!state.active) return true
    if (PortalsCanvasExtension.isPortalElement(element.id)) return state.visible.nodes.has(PortalsCanvasExtension.getNestedIds(element.id)[0])
    return ('from' in element ? state.visible.edges : state.visible.nodes).has(element.id)
  }
  private removeProjection(state: State | undefined, element: Element): void {
    if (!state || !PortalsCanvasExtension.isPortalElement(element.id)) return
    const id = PortalsCanvasExtension.getNestedIds(element.id)[0], items = state.portalElements.get(id)
    items?.delete(element); if (!items?.size) state.portalElements.delete(id)
  }
  private applyElement(state: State | undefined, element: Element): void {
    if (!state) return
    const edge = 'from' in element
    if (PortalsCanvasExtension.isPortalElement(element.id)) {
      const id = PortalsCanvasExtension.getNestedIds(element.id)[0]
      if (!state.portalElements.has(id)) state.portalElements.set(id, new Set())
      state.portalElements.get(id)!.add(element)
    }
    const hidden = !this.visible(state, element)
    const elements = edge ? [element.lineGroupEl, element.lineEndGroupEl, element.labelElement?.wrapperEl] : [element.nodeEl]
    for (const target of elements) target?.classList.toggle('mkls-view-hidden', hidden)
  }
  private editing(canvas: Canvas, element: Element, editing: boolean): void {
    const state = this.states.get(canvas)
    if (!state) return
    if (!editing) {
      const panel = state.panels.get(element)
      // Moving focus from the native body editor into YAML can blur the body.
      // Wait until focus settles before removing the still-active property editor.
      if (panel) queueMicrotask(() => {
        if (state.panels.get(element) !== panel || panel.ownerDocument.activeElement === panel) return
        this.commitPanel(state, element, panel); panel.parentElement?.remove(); state.panels.delete(element)
      })
      this.applyElement(state, element); return
    }
    if (state.panels.has(element)) return
    const container = 'from' in element ? element.labelElement?.wrapperEl : element.nodeEl
    if (!container) return
    const header = container.createDiv({ cls: 'mkls-frontmatter-panel' })
    header.createDiv({ text: '---', cls: 'mkls-frontmatter-delimiter' })
    const panel = header.createEl('textarea', { cls: 'mkls-frontmatter-text', attr: { 'aria-label': 'Element frontmatter', spellcheck: 'false' } })
    const data = element.getData(); panel.value = yamlOf(data)
    panel.readOnly = canvas.readonly || PortalsCanvasExtension.isPortalElement(element.id) || !writableRecord(data)
    panel.dataset.sourceRevision = sourceRevision(asElement(data)); panel.dataset.sourceFile = state.file
    header.createDiv({ text: '---', cls: 'mkls-frontmatter-delimiter' })
    header.addEventListener('pointerdown', event => event.stopPropagation())
    header.addEventListener('click', event => event.stopPropagation())
    header.addEventListener('dblclick', event => event.stopPropagation())
    header.addEventListener('keydown', event => event.stopPropagation())
    panel.onblur = () => {
      this.commitPanel(state, element, panel)
      const nativeEditing = 'from' in element ? element.labelElement?.isEditing : element.isEditing
      if (!nativeEditing && panel.dataset.returnToBody !== 'true') {
        panel.parentElement?.remove(); state.panels.delete(element)
        if ('from' in element && !element.getData().label) (element.labelElement as typeof element.labelElement & { destroy(): void })?.destroy()
      }
    }
    state.panels.set(element, panel)
  }
  private commitPanel(state: State, element: Element, panel: HTMLTextAreaElement): void {
    const current = 'from' in element ? state.canvas.edges.get(element.id) : state.canvas.nodes.get(element.id)
    if (state.canvas.view.file.path !== panel.dataset.sourceFile || current !== element) { this.retainPanel(element, panel); return }
    const data = element.getData(); const previous = yamlOf(data)
    if (panel.value === previous) return
    if (state.canvas.readonly || PortalsCanvasExtension.isPortalElement(element.id)) { this.retainPanel(element, panel); return }
    if (!writableRecord(data)) { this.retainPanel(element, panel); new Notice('Unsupported property record; draft retained in recovery storage'); return }
    const parsed = parseProperties(panel.value)
    const propertyGraph = { ...data.propertyGraph, version: 1 as const, yaml: parsed.errors.length ? data.propertyGraph?.yaml ?? '' : panel.value }
    if (parsed.errors.length) propertyGraph.draft = panel.value
    else { delete propertyGraph.draft; void this.draftStore.consume(state.file, element.id) }
    canvasTransaction(state.canvas, () => element.setData({ ...data, propertyGraph } as never))
    if (parsed.errors.length) new Notice(`Frontmatter draft retained: ${parsed.errors[0].line}:${parsed.errors[0].column} ${parsed.errors[0].message}`)
    this.schedule(state.canvas, element)
  }
  private hookLabel(canvas: Canvas, edge: CanvasEdge): void {
    const state = this.states.get(canvas); const label = edge.labelElement
    if (!state || !label || state.labels.has(label)) return
    state.labels.add(label)
    let intoYaml = false
    const focusOut = (event: FocusEvent) => { intoYaml = event.relatedTarget === state.panels.get(edge); queueMicrotask(() => { intoYaml = false }) }
    label.textareaEl.addEventListener('focusout', focusOut, true)
    const bodyPointer = (event: PointerEvent) => {
      const panel = state.panels.get(edge)
      if (panel && label.textareaEl.contains(event.target as Node)) { panel.dataset.returnToBody = 'true'; label.wrapperEl.win.setTimeout(() => { delete panel.dataset.returnToBody }, 0) }
    }
    label.wrapperEl.addEventListener('pointerdown', bodyPointer, true)
    const dispose = around(label as typeof label & { focus(event?: Position): void; blur(): void; destroy(force?: boolean): void }, {
      focus: (next: (event?: Position) => void) => (event?: Position) => { next.call(label, event); this.editing(canvas, edge, true) },
      blur: (next: () => void) => () => {
        const previous = label.isEditing ? label.initialTextState : edge.getData().label
        this.editing(canvas, edge, false); next.call(label)
        if (previous !== edge.getData().label) { canvasImports.changed(canvas); this.schedule(canvas, edge) }
        if (previous && !edge.getData().label && label.wrapperEl.isConnected) canvas.requestSave()
      },
      destroy: (next: (force?: boolean) => void) => (force?: boolean) => {
        const panel = state.panels.get(edge)
        // Native deletes an empty label on body blur. Keep its wrapper while
        // the user moves into frontmatter, then release it on property blur.
        if (!canvas.isClearing && canvas.edges.get(edge.id) === edge && panel && (intoYaml || panel.ownerDocument.activeElement === panel)) return
        if (panel) { this.commitPanel(state, edge, panel); panel.parentElement?.remove(); state.panels.delete(edge) }
        next.call(label, force)
        const cleanup = state.labelDisposers.get(edge); state.labelDisposers.delete(edge); cleanup?.()
      }
    })
    const input = () => { canvasImports.changed(canvas); this.plugin.app.workspace.trigger('advanced-canvas:edge-data-changed', canvas, edge) }
    label.textareaEl.addEventListener('input', input)
    // Label lives with its edge; disposer registry is released on view unload.
    state.labelDisposers.get(edge)?.(); state.labelDisposers.set(edge, () => { label.textareaEl.removeEventListener('input', input); label.textareaEl.removeEventListener('focusout', focusOut, true); label.wrapperEl.removeEventListener('pointerdown', bodyPointer, true); dispose() })
    if (label.isEditing) this.editing(canvas, edge, true)
    this.applyElement(state, edge)
  }
  private retainPanel(element: Element, panel: HTMLTextAreaElement): void {
    if (!this.draftStore) return
    if (panel.value === yamlOf(element.getData())) return
    void this.draftStore.save({ file: panel.dataset.sourceFile ?? '', id: element.id, source: panel.value, kind: 'yaml', revision: panel.dataset.sourceRevision ?? '', savedAt: new Date().toISOString() }).catch(error => new Notice(`Draft retained in memory; recovery write failed: ${String(error)}`))
    new Notice('Unsaved frontmatter retained in recovery storage; use the source editor to recover it.')
  }
  private beforeReload(canvas: Canvas, data: CanvasData, clearCanvas?: boolean): void {
    const state = this.states.get(canvas); if (!state) return
    if (clearCanvas === false) return
    const sameFile = state.file === canvas.view.file.path
    const incoming = new Map([...data.nodes, ...data.edges].map(element => [element.id, element]))
    for (const [element, panel] of state.panels) {
      const replacement = incoming.get(element.id)
      if (sameFile && replacement && sourceRevision(asElement(replacement)) === sourceRevision(asElement(element.getData()))) continue
      this.retainPanel(element, panel); panel.parentElement?.remove(); state.panels.delete(element)
    }
    for (const dispose of state.labelDisposers.values()) dispose()
    state.labelDisposers.clear(); state.labels = new WeakSet()
    state.portalElements.clear()
    if (state.file !== canvas.view.file.path) { state.active = undefined; state.service.clear(); state.file = canvas.view.file.path }
    state.reload = true; state.index = undefined
  }
  private detach(view: CanvasView): void {
    const state = this.states.get(view.canvas)
    if (!state) return
    for (const [element, panel] of state.panels) this.commitPanel(state, element, panel)
    for (const panel of state.panels.values()) panel.parentElement?.remove()
    state.panels.clear()
    for (const dispose of state.labelDisposers.values()) dispose()
    state.labelDisposers.clear()
    if (state.frame !== undefined) state.canvas.canvasEl.win.cancelAnimationFrame(state.frame)
    state.active = undefined
    for (const node of state.canvas.nodes.values()) this.applyElement(state, node)
    for (const edge of state.canvas.edges.values()) this.applyElement(state, edge)
    state.canvas.canvasControlsEl.querySelector('.mkls-view-select')?.remove()
    state.dispose(); state.service.clear(); this.states.delete(view.canvas)
  }
}
