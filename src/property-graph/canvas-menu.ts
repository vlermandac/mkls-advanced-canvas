// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Persistent plugin menu for one canvas view. It lives in the canvas wrapper, outside the zoom/pan
// transform, docked at the top inline-start corner (a bottom sheet on narrow canvases) and stays
// present for any selection. A bar gives views, schema and relationship rules; below it the
// Properties section shows the single selected element or a selection hint.
import { Menu, setIcon, type App } from 'obsidian'
import type { Canvas } from '../@types/Canvas'

export interface CanvasMenuView { id: string; name: string }
export type GuidanceStatus = { status: 'none' | 'valid' | 'unsupported'; count?: number; error?: string }
export interface CanvasMenuHost {
  app: App
  canvas: Canvas
  views(): CanvasMenuView[]
  activeView(): string | undefined
  setView(id: string | undefined): void
  createView(): void
  editView(): void
  duplicateView(): void
  deleteView(): void
  exportView(): void
  schemaStatus(): GuidanceStatus
  openSchema(): void
  rulesStatus(): GuidanceStatus
  openRelationshipRules(): void
}

const SHEET_WIDTH = 560

export default class CanvasMenu {
  readonly el: HTMLElement
  /** Mount point for the Properties section. */
  readonly sectionEl: HTMLElement
  private barEl: HTMLElement
  private resize: ResizeObserver
  private barKey?: string

  constructor(private host: CanvasMenuHost) {
    const wrapper = host.canvas.wrapperEl
    this.el = wrapper.createDiv({ cls: 'mkls-canvas-menu', attr: { role: 'region', 'aria-label': 'Canvas properties menu' } })
    this.barEl = this.el.createDiv({ cls: 'mkls-canvas-menu-bar', attr: { role: 'toolbar', 'aria-label': 'Views, schema and relationship rules' } })
    this.sectionEl = this.el.createDiv({ cls: 'mkls-canvas-menu-section' })
    // Keep canvas gestures, shortcuts and clipboard handlers away from the menu's controls.
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'copy', 'cut', 'paste'])
      this.el.addEventListener(type, event => event.stopPropagation())
    this.resize = new (wrapper.win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => this.layout())
    this.resize.observe(wrapper)
    this.layout()
    this.update()
  }

  get layoutMode(): 'dock' | 'sheet' { return this.el.dataset.layout === 'sheet' ? 'sheet' : 'dock' }

  /** Re-renders the bar when views, the active view, read-only state or guidance status changed. */
  update(): void {
    const views = this.host.views(), active = this.host.activeView(), readOnly = this.host.canvas.readonly
    const schema = this.host.schemaStatus(), rules = this.host.rulesStatus()
    const key = JSON.stringify([views, active, readOnly, schema, rules])
    if (key === this.barKey) return
    this.barKey = key
    const focused = (this.el.doc.activeElement as HTMLElement | null)?.dataset.bar
    this.barEl.empty()

    const current = views.find(view => view.id === active)
    const viewButton = this.barEl.createEl('button', { cls: 'mkls-canvas-menu-view', attr: { 'data-bar': 'views', 'aria-haspopup': 'menu', 'aria-label': `View: ${current?.name ?? 'All'}. Choose or manage saved views` } })
    setIcon(viewButton.createSpan({ cls: 'mkls-canvas-menu-icon' }), current ? 'filter' : 'layout-dashboard')
    viewButton.createSpan({ cls: 'mkls-canvas-menu-view-name', text: current?.name ?? 'All' })
    setIcon(viewButton.createSpan({ cls: 'mkls-canvas-menu-caret' }), 'chevron-down')
    viewButton.toggleClass('is-filtered', current !== undefined)
    viewButton.onclick = () => this.viewMenu(viewButton)

    this.barButton('schema', 'table-properties', 'Schema', this.schemaLabel(schema, readOnly), schema, readOnly, () => this.host.openSchema())
    this.barButton('rules', 'waypoints', 'Rules', this.rulesLabel(rules, readOnly), rules, readOnly, () => this.host.openRelationshipRules())
    if (focused) this.barEl.querySelector<HTMLElement>(`[data-bar="${focused}"]`)?.focus()
  }

  /** Moves the native selection toolbar beside the menu when the two would overlap. */
  avoidToolbar(): void {
    const menu = this.host.canvas.menu as typeof this.host.canvas.menu & { containerEl?: HTMLElement }
    const container = menu?.containerEl, menuEl = menu?.menuEl
    if (!container?.isConnected || !menuEl || !this.el.isShown()) return
    const panel = this.el.getBoundingClientRect(), box = menuEl.getBoundingClientRect(), frame = this.host.canvas.wrapperEl.getBoundingClientRect()
    const overlaps = box.width > 0 && box.left < panel.right && box.right > panel.left && box.top < panel.bottom && box.bottom > panel.top
    if (!overlaps) return
    const gap = 8
    if (this.layoutMode === 'sheet') {
      container.style.top = `${Math.max(10, panel.top - frame.top - box.height - gap)}px`; return
    }
    const rtl = this.el.doc.body.hasClass('mod-rtl')
    const shifted = rtl ? panel.left - frame.left - box.width - gap : panel.right - frame.left + gap
    if (shifted >= 10 && shifted + box.width <= frame.width - 10) container.style.left = `${shifted}px`
    else container.style.top = `${Math.min(frame.height - box.height - 10, panel.bottom - frame.top + gap)}px`
  }

  destroy(): void {
    this.resize.disconnect()
    this.el.remove()
  }

  private layout(): void {
    const width = this.host.canvas.wrapperEl.clientWidth
    this.el.dataset.layout = width > 0 && width < SHEET_WIDTH ? 'sheet' : 'dock'
  }

  private barButton(id: string, icon: string, text: string, label: string, status: GuidanceStatus, readOnly: boolean, open: () => void): void {
    const button = this.barEl.createEl('button', { cls: 'mkls-canvas-menu-button', attr: { 'data-bar': id, 'aria-label': label } })
    setIcon(button.createSpan({ cls: 'mkls-canvas-menu-icon' }), icon)
    button.createSpan({ text })
    if (status.status === 'valid' && status.count) button.createSpan({ cls: 'mkls-canvas-menu-count', text: String(status.count) })
    if (status.status === 'unsupported') setIcon(button.createSpan({ cls: 'mkls-canvas-menu-warning' }), 'alert-triangle')
    // An unreadable definition stays viewable on read-only canvases; editing needs a writable one.
    button.disabled = readOnly && status.status !== 'unsupported'
    button.onclick = open
  }

  private schemaLabel(status: GuidanceStatus, readOnly: boolean): string {
    if (status.status === 'unsupported') return `Schema cannot be read: ${status.error ?? 'unsupported data'}. Open to inspect`
    if (readOnly) return 'Schema (read-only canvas)'
    if (status.status === 'none') return 'Define node and edge property fields'
    return `Edit property schema${status.count ? ` (${status.count} field${status.count === 1 ? '' : 's'})` : ''}`
  }

  private rulesLabel(status: GuidanceStatus, readOnly: boolean): string {
    if (status.status === 'unsupported') return `Relationship rules cannot be read: ${status.error ?? 'unsupported data'}. Open to inspect`
    if (readOnly) return 'Relationship rules (read-only canvas)'
    if (status.status === 'none' || !status.count) return 'Suggest relationship types when connecting cards'
    return `Edit relationship rules (${status.count} rule${status.count === 1 ? '' : 's'})`
  }

  private viewMenu(anchor: HTMLElement): void {
    const views = this.host.views(), active = this.host.activeView(), readOnly = this.host.canvas.readonly
    const current = views.find(view => view.id === active)
    const menu = new Menu()
    menu.addItem(item => item.setTitle('All (complete canvas)').setIcon('layout-dashboard').setChecked(!current).onClick(() => this.host.setView(undefined)))
    for (const view of views) menu.addItem(item => item.setTitle(view.name).setIcon('filter').setChecked(view.id === active).onClick(() => this.host.setView(view.id)))
    menu.addSeparator()
    menu.addItem(item => item.setTitle('New view…').setIcon('plus').setDisabled(readOnly).onClick(() => this.host.createView()))
    if (current) {
      menu.addItem(item => item.setTitle(`Edit “${current.name}”…`).setIcon('pencil').setDisabled(readOnly).onClick(() => this.host.editView()))
      menu.addItem(item => item.setTitle(`Duplicate “${current.name}”…`).setIcon('copy').setDisabled(readOnly).onClick(() => this.host.duplicateView()))
      menu.addItem(item => item.setTitle(`Delete “${current.name}”`).setIcon('trash-2').setWarning(true).setDisabled(readOnly).onClick(() => this.host.deleteView()))
    }
    menu.addSeparator()
    menu.addItem(item => item.setTitle(current ? 'Export this view as a new canvas' : 'Export as a new canvas').setIcon('file-output').onClick(() => this.host.exportView()))
    const rect = anchor.getBoundingClientRect()
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, anchor.doc)
  }
}
