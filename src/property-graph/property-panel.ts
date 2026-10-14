// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Properties section of the persistent canvas menu (canvas-menu.ts). The menu places it in screen
// space, outside the zoom/pan transform. It edits the single selected node or edge and shows a
// selection hint otherwise. All writes go through PropertyPanelHost.commit, which validates YAML
// and schema before writing.
import { Platform, setIcon, type App } from 'obsidian'
import type { Canvas, CanvasEdge, CanvasNode } from '../@types/Canvas'
import { parseProperties } from './properties'
import { applySchemaDefaults, isSchemaDate, schemaFor, schemaOptionIndex, validatePropertyMap } from './schema'
import { deleteProperty, keyLine, previewValue, setProperty } from './yaml-edit'
import type { ElementSchema, PropertyMap, PropertyValue, SchemaField, SchemaFieldType, SchemaIssue } from './types'

export type PanelElement = CanvasNode | CanvasEdge
export interface PanelSnapshot { element: PanelElement; file: string; revision: string; schemaRevision: string }
export type CommitResult = { status: 'saved' } | { status: 'draft'; issues: string[] } | { status: 'refused'; message: string }
export interface PropertyPanelHost {
  app: App
  canvas: Canvas
  file(): string
  /** Committed YAML (never the draft). */
  committedYaml(element: PanelElement): string
  draft(element: PanelElement): string | undefined
  revision(element: PanelElement): string
  schemaRevision(): string
  schemaConfig(): unknown
  /** Why the element's properties cannot be written, or undefined when writable. */
  readOnlyReason(element: PanelElement): string | undefined
  commit(snapshot: PanelSnapshot, yaml: string): CommitResult
  discardDraft(snapshot: PanelSnapshot): CommitResult
  /** Keep unsaved input in recovery storage without writing the canvas. */
  retain(snapshot: PanelSnapshot, yaml: string): void
  openSource(element: PanelElement): void
}

type Mode = 'fields' | 'yaml'
interface FieldSource { source: string; values: PropertyMap | null; draft?: 'mapping' | 'syntax' }
type ControlType = SchemaFieldType | 'null'
const COLLAPSED_KEY = 'mkls-property-panel-collapsed', MODE_KEY = 'mkls-property-panel-mode'
/** Shown when no single element is selected; `subtitle` sits beside the section title. */
export interface SelectionHint { subtitle: string; text: string }
export const DEFAULT_HINT: SelectionHint = { subtitle: 'Nothing selected', text: 'Select one card or edge to see and edit its properties.' }
const TYPE_LABELS: Record<ControlType, string> = { text: 'Text', number: 'Number', boolean: 'Checkbox', date: 'Date', list: 'List', object: 'Object', null: 'Empty' }
const TYPE_ICONS: Record<ControlType, string> = { text: 'text', number: 'binary', boolean: 'check-square', date: 'calendar', list: 'list', object: 'braces', null: 'circle-slash' }
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key) as boolean
const isEdge = (element: PanelElement): element is CanvasEdge => 'from' in element

function inferType(value: PropertyValue): ControlType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return isSchemaDate(value) ? 'date' : 'text'
}
function fits(type: ControlType, value: PropertyValue): boolean {
  switch (type) {
    case 'text': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'date': return isSchemaDate(value)
    case 'list': return Array.isArray(value)
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'null': return value === null
  }
}
function display(value: PropertyValue): string { return typeof value === 'string' ? value : JSON.stringify(value) }
function elementKind(element: PanelElement): string {
  if (isEdge(element)) return 'Edge'
  switch (element.getData().type) {
    case 'text': return 'Text card'
    case 'file': return 'File card'
    case 'link': return 'Web card'
    case 'group': return 'Group'
    default: return 'Card'
  }
}

export default class PropertyPanel {
  readonly el: HTMLElement
  private headerEl: HTMLElement
  private bodyEl: HTMLElement
  private snapshot?: PanelSnapshot
  private collapsed: boolean
  private mode: Mode
  /** Candidate YAML of the control the user is changing; cleared by commit or revert. */
  private pending?: () => string | undefined
  private message?: { text: string; issues?: string[]; kind: 'error' | 'warning' }
  private stale = false
  private committing = false
  private renderTimer?: number
  private yamlFocusLine?: number
  private hint = DEFAULT_HINT

  /** `layoutChanged` runs after each render so the menu can keep clear of the native toolbar. */
  constructor(private host: PropertyPanelHost, parent: HTMLElement, private layoutChanged: () => void) {
    this.collapsed = host.app.loadLocalStorage(COLLAPSED_KEY) === true
    this.mode = host.app.loadLocalStorage(MODE_KEY) === 'yaml' ? 'yaml' : 'fields'
    this.el = parent.createDiv({ cls: 'mkls-property-panel', attr: { role: 'region', 'aria-label': 'Element properties' } })
    this.headerEl = this.el.createDiv({ cls: 'mkls-property-panel-header' })
    this.bodyEl = this.el.createDiv({ cls: 'mkls-property-panel-body' })
    this.el.addEventListener('focusout', event => {
      if (!this.el.contains(event.relatedTarget as Node | null) && this.stale && !this.pending) this.scheduleRender()
    })
    this.render()
  }

  get element(): PanelElement | undefined { return this.snapshot?.element }

  /**
   * Shows one element's properties, or (after committing pending input) the hint for no or several
   * selected elements.
   */
  show(element: PanelElement | undefined, hint = DEFAULT_HINT): void {
    if (element && element === this.snapshot?.element) return
    if (!element && !this.snapshot && hint.subtitle === this.hint.subtitle && hint.text === this.hint.text) return
    this.flush()
    this.message = undefined; this.stale = false; this.yamlFocusLine = undefined
    this.snapshot = element ? this.capture(element) : undefined
    this.hint = hint
    this.render()
  }

  /** The shown element or the schema may have changed outside the panel. */
  refresh(force = false): void {
    const snapshot = this.snapshot
    if (!snapshot || this.committing) return
    if (this.host.revision(snapshot.element) === snapshot.revision && this.host.schemaRevision() === snapshot.schemaRevision && !this.stale) {
      // Edges report many render-only changes; rebuild only when asked (e.g. read-only toggled).
      if (force && !this.pending && !this.el.contains(this.el.doc.activeElement)) this.render()
      return
    }
    if (this.pending) {
      // Keep the user's unsaved input on screen; commits are refused until they reload.
      this.stale = true
      this.message = { kind: 'warning', text: 'This element or the canvas schema changed while you were editing. Your input is kept; reload to edit the current version.' }
      this.renderMessages(); return
    }
    this.snapshot = this.capture(snapshot.element); this.stale = false; this.message = undefined
    this.render()
  }

  /** Commits pending input (selection change, unload). */
  flush(): void {
    const pending = this.pending
    if (!pending || !this.snapshot) return
    this.pending = undefined
    const yaml = pending()
    if (yaml !== undefined) this.apply(yaml)
  }

  /** Moves pending input to recovery storage without writing the canvas (data reload). */
  retainPending(): void {
    const pending = this.pending
    this.pending = undefined
    const yaml = pending?.()
    if (this.snapshot && yaml !== undefined) this.host.retain(this.snapshot, yaml)
  }

  expandAndFocus(): void {
    if (!this.snapshot) return
    this.setCollapsed(false)
    const target = this.bodyEl.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([readonly]), button')
    target?.focus()
  }

  destroy(): void {
    this.flush()
    if (this.renderTimer !== undefined) this.el.win.clearTimeout(this.renderTimer)
    this.el.remove()
  }

  private capture(element: PanelElement): PanelSnapshot {
    return { element, file: this.host.file(), revision: this.host.revision(element), schemaRevision: this.host.schemaRevision() }
  }

  private setCollapsed(collapsed: boolean): void {
    if (collapsed) this.flush()
    this.collapsed = collapsed
    this.host.app.saveLocalStorage(COLLAPSED_KEY, collapsed)
    this.render()
  }

  private setMode(mode: Mode, line?: number): void {
    this.flush()
    this.mode = mode; this.yamlFocusLine = line
    this.host.app.saveLocalStorage(MODE_KEY, mode)
    this.render()
    if (mode === 'yaml') this.bodyEl.querySelector<HTMLTextAreaElement>('.mkls-property-yaml')?.focus()
  }

  private scheduleRender(): void {
    if (this.renderTimer !== undefined) return
    // Let focus settle first (Tab from one field to the next commits on blur).
    this.renderTimer = this.el.win.setTimeout(() => {
      this.renderTimer = undefined
      if (this.stale && !this.pending && this.snapshot && !this.el.contains(this.el.doc.activeElement)) {
        this.snapshot = this.capture(this.snapshot.element); this.stale = false; this.message = undefined
      }
      this.render()
    }, 0)
  }

  private apply(yaml: string): boolean {
    const snapshot = this.snapshot
    if (!snapshot) return false
    if (this.stale) {
      this.host.retain(snapshot, yaml)
      this.message = { kind: 'warning', text: 'Not saved: this element or the schema changed. Your input is in recovery storage; reload and use the source editor to recover it.' }
      this.renderMessages(); return false
    }
    this.committing = true
    let result: CommitResult
    try { result = this.host.commit(snapshot, yaml) } finally { this.committing = false }
    if (result.status === 'refused') {
      this.message = { kind: 'error', text: result.message }
      this.renderMessages(); return false
    }
    this.snapshot = this.capture(snapshot.element)
    // The draft banner reports draft issues; only unparseable drafts need the YAML editor.
    this.message = undefined
    if (result.status === 'draft' && this.mode === 'fields' && parseProperties(yaml).values === null) this.mode = 'yaml'
    this.scheduleRender()
    return result.status === 'saved'
  }

  // Rendering

  /**
   * Source for field edits. A draft that parses as a mapping (e.g. schema-incomplete while required
   * fields are filled one by one) stays editable as fields; views keep using the committed YAML.
   */
  private fieldSource(element: PanelElement): FieldSource {
    const draft = this.host.draft(element)
    if (draft !== undefined) {
      const values = parseProperties(draft).values
      if (values) return { source: draft, values, draft: 'mapping' }
      const committed = this.host.committedYaml(element)
      return { source: committed, values: parseProperties(committed).values, draft: 'syntax' }
    }
    const committed = this.host.committedYaml(element)
    return { source: committed, values: parseProperties(committed).values }
  }

  private render(): void {
    const snapshot = this.snapshot
    if (!snapshot) { this.renderHint(); return }
    const focus = this.focusState()
    const element = snapshot.element
    const fields = this.fieldSource(element)
    const values = fields.values
    this.el.toggleClass('is-collapsed', this.collapsed)
    this.el.removeClass('is-empty')

    this.headerEl.empty()
    const toggle = this.headerEl.createEl('button', { cls: 'mkls-property-panel-toggle', attr: { 'aria-expanded': String(!this.collapsed), 'aria-label': this.collapsed ? 'Expand properties' : 'Collapse properties' } })
    setIcon(toggle.createSpan({ cls: 'mkls-property-panel-chevron' }), 'chevron-down')
    toggle.createSpan({ cls: 'mkls-property-panel-title', text: 'Properties' })
    toggle.createSpan({ cls: 'mkls-property-panel-subtitle', text: `${elementKind(element)} · ${values ? Object.keys(values).length : '?'}` })
    toggle.onclick = () => this.setCollapsed(!this.collapsed)
    if (!this.collapsed) {
      const actions = this.headerEl.createDiv({ cls: 'mkls-property-panel-actions' })
      this.iconButton(actions, 'list', 'Edit as fields', () => this.setMode('fields'), this.mode === 'fields')
      this.iconButton(actions, 'code-2', 'Edit as YAML', () => this.setMode('yaml'), this.mode === 'yaml')
      this.iconButton(actions, 'file-code', 'Open source editor (properties and body)', () => { this.flush(); this.host.openSource(element) })
    }

    this.bodyEl.empty()
    if (this.collapsed) { this.layoutChanged(); return }
    this.bodyEl.createDiv({ cls: 'mkls-property-panel-messages' })
    this.renderMessages()
    if (this.mode === 'yaml') this.renderYaml(snapshot)
    else this.renderFields(snapshot, fields)
    this.restoreFocus(focus)
    this.layoutChanged()
  }

  /** No single selection: a header that still collapses, and a one-line hint. */
  private renderHint(): void {
    this.el.toggleClass('is-collapsed', this.collapsed)
    this.el.addClass('is-empty')
    this.headerEl.empty()
    const toggle = this.headerEl.createEl('button', { cls: 'mkls-property-panel-toggle', attr: { 'aria-expanded': String(!this.collapsed), 'aria-label': this.collapsed ? 'Expand properties' : 'Collapse properties' } })
    setIcon(toggle.createSpan({ cls: 'mkls-property-panel-chevron' }), 'chevron-down')
    toggle.createSpan({ cls: 'mkls-property-panel-title', text: 'Properties' })
    toggle.createSpan({ cls: 'mkls-property-panel-subtitle', text: this.hint.subtitle })
    toggle.onclick = () => this.setCollapsed(!this.collapsed)
    this.bodyEl.empty()
    if (!this.collapsed) this.bodyEl.createDiv({ cls: 'mkls-property-hint mkls-property-selection-hint', text: this.hint.text })
    this.layoutChanged()
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, active = false): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label, 'aria-pressed': String(active) } })
    button.toggleClass('is-active', active)
    setIcon(button, icon)
    button.onclick = onClick
    return button
  }

  private renderMessages(): void {
    const container = this.bodyEl.querySelector<HTMLElement>('.mkls-property-panel-messages')
    const snapshot = this.snapshot
    if (!container || !snapshot) return
    container.empty()
    const element = snapshot.element
    const readOnly = this.host.readOnlyReason(element)
    if (readOnly) container.createDiv({ cls: 'mkls-property-note', text: readOnly })
    const schema = schemaFor(this.host.schemaConfig(), isEdge(element) ? 'edges' : 'nodes')
    if (schema.status === 'unsupported' && !readOnly) container.createDiv({ cls: 'mkls-property-note mod-warning', text: `The canvas schema cannot be read (${schema.error}). Properties are read-only until it is fixed.` })
    const draft = this.host.draft(element)
    if (draft !== undefined && !this.message) {
      const mapping = parseProperties(draft).values !== null
      const box = container.createDiv({ cls: 'mkls-property-note mod-warning', attr: { role: 'status' } })
      box.createDiv({ text: mapping
        ? 'Draft not yet applied. Keep editing until it meets the schema; views use the last valid properties until then.'
        : 'This element has an unapplied draft with YAML errors. Views use the last valid properties.' })
      this.issueList(box, this.draftIssues(draft, schema.definition))
      const row = box.createDiv({ cls: 'mkls-property-note-actions' })
      if (!mapping && this.mode !== 'yaml') row.createEl('button', { text: 'Edit draft' }).onclick = () => this.setMode('yaml')
      if (!readOnly) row.createEl('button', { text: 'Discard draft' }).onclick = () => {
        const result = this.host.discardDraft(snapshot)
        this.message = result.status === 'refused' ? { kind: 'error', text: result.message } : undefined
        this.snapshot = this.capture(element); this.render()
      }
    }
    if (this.message) {
      const box = container.createDiv({ cls: 'mkls-property-note ' + (this.message.kind === 'error' ? 'mod-error' : 'mod-warning'), attr: { role: 'alert' } })
      box.createDiv({ text: this.message.text })
      this.issueList(box, this.message.issues ?? [])
      if (this.stale) box.createDiv({ cls: 'mkls-property-note-actions' }).createEl('button', { text: 'Reload' }).onclick = () => {
        this.pending = undefined; this.stale = false; this.message = undefined
        this.snapshot = this.capture(element); this.render()
      }
    }
  }

  private issueList(parent: HTMLElement, issues: string[]): void {
    if (!issues.length) return
    const list = parent.createEl('ul', { cls: 'mkls-property-issues' })
    for (const issue of issues) list.createEl('li', { text: issue })
  }

  private draftIssues(draft: string, definition?: ElementSchema): string[] {
    const parsed = parseProperties(draft)
    if (!parsed.values) return parsed.errors.map(error => `Line ${error.line}:${error.column} ${error.message}`)
    return definition ? validatePropertyMap(parsed.values, definition).map(issue => `${issue.key}: ${issue.message}`) : []
  }

  private renderYaml(snapshot: PanelSnapshot): void {
    const element = snapshot.element
    const readOnly = this.host.readOnlyReason(element) !== undefined
    const source = this.host.draft(element) ?? this.host.committedYaml(element)
    const area = this.bodyEl.createEl('textarea', { cls: 'mkls-property-yaml', attr: { 'aria-label': 'Properties as YAML', spellcheck: 'false', 'data-focus': 'yaml' } })
    area.value = source; area.readOnly = readOnly
    area.rows = Math.min(14, Math.max(4, source.split('\n').length + 1))
    const mod = Platform.isMacOS ? '⌘' : 'Ctrl'
    this.bodyEl.createDiv({ cls: 'mkls-property-hint', text: `${mod}+Enter or leaving the field applies · Esc reverts · comments are kept` })
    const commit = () => { this.pending = undefined; if (area.value !== source) this.apply(area.value) }
    area.addEventListener('input', () => { this.pending = () => area.value })
    area.addEventListener('blur', () => { if (this.pending) commit() })
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit() }
      else if (event.key === 'Escape') { event.preventDefault(); this.pending = undefined; area.value = source; this.returnFocus() }
    })
    if (this.yamlFocusLine !== undefined) {
      const offset = source.split('\n').slice(0, this.yamlFocusLine - 1).join('\n').length + (this.yamlFocusLine > 1 ? 1 : 0)
      this.yamlFocusLine = undefined
      this.el.win.setTimeout(() => { area.focus(); area.setSelectionRange(offset, offset) }, 0)
    }
  }

  private renderFields(snapshot: PanelSnapshot, fields: FieldSource): void {
    const element = snapshot.element
    const schema = schemaFor(this.host.schemaConfig(), isEdge(element) ? 'edges' : 'nodes')
    const { source, values } = fields
    // Only a draft that is not a mapping blocks field edits; it must be fixed or discarded in YAML.
    const readOnly = this.host.readOnlyReason(element) !== undefined || schema.status === 'unsupported' || fields.draft === 'syntax'
    if (!values) {
      this.bodyEl.createDiv({ cls: 'mkls-property-note mod-error', text: 'The saved YAML cannot be read as fields.' })
      this.bodyEl.createEl('button', { text: 'Edit as YAML' }).onclick = () => this.setMode('yaml')
      return
    }
    const definition = schema.definition
    const issues = new Map<string, string>()
    for (const issue of definition ? validatePropertyMap(values, definition) : [] as SchemaIssue[]) if (!issues.has(issue.key)) issues.set(issue.key, issue.message)
    const list = this.bodyEl.createDiv({ cls: 'mkls-property-list' })
    const known = new Set<string>()
    for (const field of definition?.fields ?? []) {
      known.add(field.key)
      this.renderRow(list, source, field.key, owns(values, field.key), values[field.key], field, issues.get(field.key), readOnly)
    }
    const extras = Object.keys(values).filter(key => !known.has(key))
    if (definition && extras.length) list.createDiv({ cls: 'mkls-property-section', text: definition.allowAdditional ? 'Other properties' : 'Not in schema' })
    for (const key of extras) this.renderRow(list, source, key, true, values[key], undefined, issues.get(key), readOnly)
    if (!definition?.fields.length && !extras.length) list.createDiv({ cls: 'mkls-property-empty', text: definition ? 'This schema defines no fields.' : 'No properties yet.' })

    if (readOnly) return
    if (definition) {
      const missingDefaults = definition.fields.filter(field => owns(field, 'default') && !owns(values, field.key))
      if (missingDefaults.length) {
        const button = this.bodyEl.createEl('button', { cls: 'mkls-property-defaults', text: missingDefaults.length === 1 ? 'Add 1 default value' : `Add ${missingDefaults.length} default values` })
        button.setAttribute('aria-label', 'Adds: ' + missingDefaults.map(field => field.key).join(', '))
        button.onclick = () => {
          try { this.apply(applySchemaDefaults(source, definition).yaml) }
          catch (error) { this.message = { kind: 'error', text: String(error instanceof Error ? error.message : error) }; this.renderMessages() }
        }
      }
    }
    if (!definition || definition.allowAdditional) this.renderAddForm(source, values, definition)
    else this.bodyEl.createDiv({ cls: 'mkls-property-hint', text: 'This schema does not allow other properties.' })
  }

  private renderRow(list: HTMLElement, source: string, key: string, present: boolean, value: PropertyValue | undefined, field: SchemaField | undefined, issue: string | undefined, readOnly: boolean): void {
    const type: ControlType = field?.type ?? inferType(value ?? null)
    const row = list.createDiv({ cls: 'mkls-property-row', attr: { 'data-key': key } })
    row.toggleClass('is-missing', !present); row.toggleClass('has-issue', issue !== undefined)
    const label = row.createDiv({ cls: 'mkls-property-key' })
    setIcon(label.createSpan({ cls: 'mkls-property-type', attr: { 'aria-label': TYPE_LABELS[type] } }), TYPE_ICONS[type])
    label.createSpan({ cls: 'mkls-property-name', text: key, attr: field?.description ? { 'aria-label': field.description } : {} })
    if (field?.required) label.createSpan({ cls: 'mkls-property-required', text: '*', attr: { 'aria-label': 'Required' } })
    const control = row.createDiv({ cls: 'mkls-property-value' })
    const setValue = (next: PropertyValue): string | undefined => {
      try { return setProperty(source, key, next) } catch (error) { this.rowError(row, error); return undefined }
    }
    if (present && !readOnly && !field?.required) {
      const remove = this.iconButton(row, 'x', `Remove ${key}`, () => { this.pending = undefined; try { this.apply(deleteProperty(source, key)) } catch (error) { this.rowError(row, error) } })
      remove.addClass('mkls-property-remove')
    } else row.createSpan({ cls: 'mkls-property-remove-spacer' })
    if (issue) row.createDiv({ cls: 'mkls-property-issue', text: issue })
    const notes = [field?.description, !present && field && owns(field, 'default') ? `Default: ${display(field.default!)}` : undefined].filter(Boolean)
    if (notes.length && !issue) row.createDiv({ cls: 'mkls-property-description', text: notes.join(' · ') })

    if (present && value !== undefined && !fits(type, value) && !(value === null && (field?.nullable || !field))) {
      // Wrong type for the schema: show it unchanged rather than coercing it.
      control.createEl('code', { cls: 'mkls-property-preview', text: previewValue(value) })
      this.editInYaml(control, source, key)
      return
    }
    this.renderControl(control, row, key, type, present, value, field, readOnly, setValue, source)
  }

  private renderControl(control: HTMLElement, row: HTMLElement, key: string, type: ControlType, present: boolean, value: PropertyValue | undefined, field: SchemaField | undefined, readOnly: boolean, setValue: (next: PropertyValue) => string | undefined, source: string): void {
    const focusId = 'key:' + key
    const commit = (next: PropertyValue) => { this.pending = undefined; const yaml = setValue(next); if (yaml !== undefined && yaml !== source) this.apply(yaml) }
    if (field?.options) {
      const select = control.createEl('select', { cls: 'dropdown', attr: { 'data-focus': focusId, 'aria-label': key } })
      select.disabled = readOnly
      const index = present ? schemaOptionIndex(field.options, value!) : -1
      // A present value outside the options (or null) must not look like the first option.
      if (!present) select.createEl('option', { text: 'Not set', value: '' })
      else if (index < 0) select.createEl('option', { text: value === null ? 'Empty (null)' : `${display(value!)} (not allowed)`, value: '' })
      field.options.forEach((option, i) => select.createEl('option', { text: display(option), value: String(i) }))
      select.value = index >= 0 ? String(index) : ''
      select.onchange = () => { if (select.value !== '') commit(field.options![Number(select.value)]) }
      return
    }
    switch (type) {
      case 'boolean': {
        // Missing and null booleans use a select so neither looks like an unchecked (false) box.
        if (!present || value === null) {
          const select = control.createEl('select', { cls: 'dropdown', attr: { 'data-focus': focusId, 'aria-label': key } })
          select.disabled = readOnly
          select.createEl('option', { text: present ? 'Empty (null)' : 'Not set', value: '' })
          select.createEl('option', { text: 'Checked (true)', value: 'true' }); select.createEl('option', { text: 'Unchecked (false)', value: 'false' })
          select.onchange = () => { if (select.value) commit(select.value === 'true') }
          return
        }
        const box = control.createEl('input', { type: 'checkbox', cls: 'metadata-input-checkbox', attr: { 'data-focus': focusId, 'aria-label': key } })
        box.checked = value === true; box.disabled = readOnly
        box.onchange = () => commit(box.checked)
        return
      }
      case 'list': case 'object': {
        if (present && type === 'list' && Array.isArray(value) && value.every(item => typeof item === 'string')) { this.renderStringList(control, source, key, value, readOnly, commit); return }
        if (present) { control.createEl('code', { cls: 'mkls-property-preview', text: previewValue(value!) }); this.editInYaml(control, source, key); return }
        if (readOnly) { control.createSpan({ cls: 'mkls-property-absent', text: 'Not set' }); return }
        const initial: PropertyValue = owns(field ?? {}, 'default') ? field!.default! : type === 'list' ? [] : Object.create(null) as PropertyMap
        control.createEl('button', { text: owns(field ?? {}, 'default') ? `Add default (${display(initial)})` : type === 'list' ? 'Add empty list' : 'Add empty object', attr: { 'data-focus': focusId } }).onclick = () => commit(initial)
        return
      }
      default: {
        const text = type === 'text' && typeof value === 'string' && value.includes('\n')
        const input = text ? control.createEl('textarea', { cls: 'mkls-property-input' }) : control.createEl('input', { cls: 'mkls-property-input', type: type === 'date' ? 'date' : 'text' })
        input.setAttribute('data-focus', focusId); input.setAttribute('aria-label', key)
        if (type === 'number') input.setAttribute('inputmode', 'decimal')
        const original = present && value !== null && value !== undefined ? display(value) : ''
        input.value = original
        if (!present) input.placeholder = owns(field ?? {}, 'default') ? `Default: ${display(field!.default!)}` : 'Not set'
        else if (value === null) input.placeholder = 'Empty (null)'
        if (readOnly) { input.readOnly = true; if (input.tagName === 'INPUT' && type === 'date') input.disabled = true; return }
        const parse = (): { value?: PropertyValue; error?: string } => {
          const raw = input.value
          if (type === 'number') {
            if (!raw.trim()) return { error: 'Enter a number, or remove the property' }
            return NUMBER.test(raw.trim()) && Number.isFinite(Number(raw)) ? { value: Number(raw) } : { error: 'Not a finite number' }
          }
          if (type === 'date') return isSchemaDate(raw) ? { value: raw } : { error: raw ? 'Use a YYYY-MM-DD date' : 'Enter a date, or remove the property' }
          return { value: raw }
        }
        const candidate = () => {
          if (input.value === original) return undefined
          if (!present && input.value === '') return undefined
          const result = parse()
          if (result.error !== undefined) { this.rowError(row, result.error); return undefined }
          return setValue(result.value!)
        }
        input.addEventListener('input', () => { this.pending = candidate; row.removeClass('has-input-error'); row.querySelector('.mkls-property-input-error')?.remove() })
        // Popout windows have their own constructors: compare tag names, call handlers directly.
        const change = () => { if (!this.pending) return; this.pending = undefined; const yaml = candidate(); if (yaml !== undefined) this.apply(yaml) }
        input.addEventListener('change', change)
        input.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Escape') { event.preventDefault(); this.pending = undefined; input.value = original; this.returnFocus() }
          else if (event.key === 'Enter' && input.tagName === 'INPUT') { event.preventDefault(); change() }
        })
        if (!present && owns(field ?? {}, 'default')) control.createEl('button', { cls: 'mkls-property-use-default', text: 'Use default' }).onclick = () => commit(field!.default!)
      }
    }
  }

  private renderStringList(control: HTMLElement, source: string, key: string, items: string[], readOnly: boolean, commit: (next: PropertyValue) => void): void {
    const list = control.createDiv({ cls: 'mkls-property-string-list' })
    items.forEach((item, index) => {
      const line = list.createDiv({ cls: 'mkls-property-string-item' })
      const input = line.createEl('input', { type: 'text', cls: 'mkls-property-input', attr: { 'data-focus': `key:${key}:${index}`, 'aria-label': `${key} item ${index + 1}` } })
      input.value = item; input.readOnly = readOnly
      if (readOnly) return
      const next = () => items.map((value, i) => i === index ? input.value : value)
      input.addEventListener('input', () => { this.pending = () => { try { return setProperty(source, key, next()) } catch { return undefined } } })
      const change = () => { if (this.pending) commit(next()) }
      input.addEventListener('change', change)
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); this.pending = undefined; input.value = item; this.returnFocus() }
        else if (event.key === 'Enter') { event.preventDefault(); change() }
      })
      this.iconButton(line, 'x', `Remove item ${index + 1}`, () => { this.pending = undefined; commit(items.filter((_, i) => i !== index)) })
    })
    if (!readOnly) {
      const add = list.createEl('button', { cls: 'mkls-property-add-item', text: 'Add item', attr: { 'data-focus': `key:${key}:add` } })
      add.onclick = () => commit([...items, ''])
    }
  }

  private editInYaml(control: HTMLElement, source: string, key: string): void {
    control.createEl('button', { cls: 'mkls-property-edit-yaml', text: 'Edit in YAML' }).onclick = () => this.setMode('yaml', keyLine(source, key))
  }

  private renderAddForm(source: string, values: PropertyMap, definition?: ElementSchema): void {
    const form = this.bodyEl.createDiv({ cls: 'mkls-property-add' })
    form.createDiv({ cls: 'mkls-property-section', text: 'Add property' })
    const line = form.createDiv({ cls: 'mkls-property-add-line' })
    const name = line.createEl('input', { type: 'text', cls: 'mkls-property-input', attr: { placeholder: 'Name', 'aria-label': 'New property name', 'data-focus': 'add-key', spellcheck: 'false' } })
    const type = line.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'New property type', 'data-focus': 'add-type' } })
    for (const option of ['text', 'number', 'boolean', 'date', 'list', 'object'] as SchemaFieldType[]) type.createEl('option', { text: TYPE_LABELS[option], value: option })
    const valueHost = form.createDiv({ cls: 'mkls-property-add-value' })
    const error = form.createDiv({ cls: 'mkls-property-input-error' })
    const button = form.createEl('button', { cls: 'mod-cta', text: 'Add', attr: { 'data-focus': 'add-button' } })
    let valueInput: HTMLInputElement | undefined
    const renderValue = () => {
      valueHost.empty(); valueInput = undefined
      const kind = type.value as SchemaFieldType
      if (kind === 'list' || kind === 'object') { valueHost.createSpan({ cls: 'mkls-property-hint', text: kind === 'list' ? 'Starts as an empty list.' : 'Starts as an empty object; edit it in YAML.' }); return }
      valueInput = valueHost.createEl('input', { cls: kind === 'boolean' ? 'metadata-input-checkbox' : 'mkls-property-input', type: kind === 'boolean' ? 'checkbox' : kind === 'date' ? 'date' : 'text', attr: { 'aria-label': 'New property value', 'data-focus': 'add-value', placeholder: kind === 'number' ? '0' : 'Value' } })
      if (kind === 'number') valueInput.setAttribute('inputmode', 'decimal')
      valueInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); add() } })
      if (kind === 'boolean') valueHost.createSpan({ cls: 'mkls-property-hint', text: 'Checked is true; unchecked is false.' })
    }
    // A name defined by the schema uses the schema's type.
    const syncType = () => {
      const field = definition?.fields.find(item => item.key === name.value)
      if (field && type.value !== field.type) { type.value = field.type; renderValue() }
      type.disabled = field !== undefined
    }
    const add = () => {
      error.setText('')
      const key = name.value
      if (!key.trim()) { error.setText('Enter a property name'); name.focus(); return }
      if (owns(values, key)) { error.setText(`${key} already exists; edit it above`); return }
      const kind = type.value as SchemaFieldType
      let value: PropertyValue
      const raw = valueInput?.value ?? ''
      switch (kind) {
        case 'number':
          if (!NUMBER.test(raw.trim()) || !Number.isFinite(Number(raw))) { error.setText('Enter a finite number'); valueInput?.focus(); return }
          value = Number(raw); break
        case 'date':
          if (!isSchemaDate(raw)) { error.setText('Enter a YYYY-MM-DD date'); valueInput?.focus(); return }
          value = raw; break
        case 'boolean': value = valueInput?.checked === true; break
        case 'list': value = []; break
        case 'object': value = Object.create(null) as PropertyMap; break
        default: value = raw
      }
      try {
        if (this.apply(setProperty(source, key, value))) this.el.win.setTimeout(() => this.bodyEl.querySelector<HTMLElement>('[data-focus="add-key"]')?.focus(), 0)
      } catch (cause) { error.setText(String(cause instanceof Error ? cause.message : cause)) }
    }
    name.addEventListener('input', syncType)
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (valueInput) valueInput.focus(); else add() } })
    type.onchange = renderValue
    button.onclick = add
    renderValue()
  }

  /** Esc leaves the panel for the canvas, so canvas shortcuts work again without a click. */
  private returnFocus(): void {
    this.host.canvas.wrapperEl.focus({ preventScroll: true })
  }

  private rowError(row: HTMLElement, error: unknown): void {
    row.addClass('has-input-error')
    row.querySelector('.mkls-property-input-error')?.remove()
    row.createDiv({ cls: 'mkls-property-input-error', text: String(error instanceof Error ? error.message : error), attr: { role: 'alert' } })
  }

  private focusState(): { id: string; start: number | null; end: number | null } | undefined {
    const active = this.el.doc.activeElement as HTMLElement | null
    if (!active || !this.el.contains(active) || !active.dataset.focus) return undefined
    const text = active as HTMLInputElement
    let start: number | null = null, end: number | null = null
    try { start = text.selectionStart; end = text.selectionEnd } catch { /* checkbox/date inputs have no selection */ }
    return { id: active.dataset.focus, start, end }
  }

  private restoreFocus(state: ReturnType<PropertyPanel['focusState']>): void {
    if (!state) return
    const target = this.bodyEl.querySelector<HTMLInputElement>(`[data-focus="${CSS.escape(state.id)}"]`)
    if (!target) return
    target.focus()
    try { if (state.start !== null) target.setSelectionRange(state.start, state.end) } catch { /* not a text control */ }
  }
}
