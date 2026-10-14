// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Editor for a canvas's relationship guidance. Each rule reads as a sentence: when connecting a
// card of these types to a card of those types, offer these relationship types. Rules only
// suggest choices while connecting; they never validate or change existing edges.
import { Modal, Setting, setIcon, type App } from 'obsidian'
import type { RelationshipGuidance, RelationshipRule } from './types'
import { validateRelationshipGuidance } from './relationships'

/** Optional autocomplete source: known values of a property on cards ('nodes') or edges ('edges'). */
export type RelationSuggest = (key: string, kind: 'nodes' | 'edges') => string[]
type ListKey = 'from' | 'to' | 'relations'

const DEFAULT_GUIDANCE: RelationshipGuidance = { version: 1, nodeTypeKey: 'kind', edgeTypeKey: 'relation', rules: [] }
let datalistCounter = 0

function phrase(values: string[], fallback: string): string {
  if (!values.length) return fallback
  if (values.length === 1) return values[0]
  return values.slice(0, -1).join(', ') + ' or ' + values[values.length - 1]
}

export default class RelationRulesModal extends Modal {
  private guidance: RelationshipGuidance
  private rulesEl!: HTMLElement
  private messageEl!: HTMLElement
  /** Commits text typed into a list field but not yet turned into a chip. */
  private flushers = new Set<() => void>()
  private listId = `mkls-relation-suggest-${++datalistCounter}`

  constructor(app: App, current: RelationshipGuidance | undefined, private save: (value: RelationshipGuidance) => void, private remove?: () => void, private suggest?: RelationSuggest) {
    super(app)
    // Deep copy keeps rule IDs and fields this editor does not know about.
    this.guidance = JSON.parse(JSON.stringify(current ?? DEFAULT_GUIDANCE)) as RelationshipGuidance
    if (!Array.isArray(this.guidance.rules)) this.guidance.rules = []
  }

  onOpen(): void {
    this.titleEl.setText('Relationship rules')
    this.modalEl.addClass('mkls-relation-rules-modal')
    const content = this.contentEl
    content.createEl('p', { text: 'When you drag a new connection between two cards, matching rules suggest relationship types to choose from. Rules never block a connection and do not check existing edges.' })

    new Setting(content).setName('Card type property')
      .setDesc('Card property that holds its type, such as kind. A card with a list of types matches each of them.')
      .addText(text => text.setValue(this.guidance.nodeTypeKey).onChange(value => { this.guidance.nodeTypeKey = value.trim(); this.renderSummaries() }))
    new Setting(content).setName('Relationship property')
      .setDesc('New connections get the chosen type in this edge property and as their label.')
      .addText(text => text.setValue(this.guidance.edgeTypeKey).onChange(value => { this.guidance.edgeTypeKey = value.trim() }))

    content.createEl('h3', { cls: 'mkls-relation-rules-heading', text: 'Rules' })
    this.rulesEl = content.createDiv({ cls: 'mkls-relation-rules' })
    new Setting(content).addButton(button => button.setButtonText('Add rule').onClick(() => {
      this.guidance.rules.push({ id: crypto.randomUUID(), from: [], to: [], relations: [] })
      this.renderRules()
      this.rulesEl.lastElementChild?.querySelector<HTMLInputElement>('input[data-list="from"]')?.focus()
    }))

    this.messageEl = content.createDiv({ cls: 'mkls-relation-rules-error', attr: { role: 'alert' } })
    const actions = new Setting(content)
    if (this.remove) actions.addButton(button => button.setButtonText('Remove all rules').setDestructive().setTooltip('Removes relationship guidance from this canvas; existing edges stay as they are').onClick(() => {
      try { this.remove!(); this.close() } catch (error) { this.showError(error) }
    }))
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
    actions.addButton(button => button.setButtonText('Save rules').setCta().onClick(() => this.submit()))
    this.renderRules()
  }

  onClose(): void { this.flushers.clear(); this.contentEl.empty() }

  private submit(): void {
    for (const flush of this.flushers) flush()
    try {
      const value = JSON.parse(JSON.stringify(this.guidance)) as RelationshipGuidance
      for (const rule of value.rules) {
        const name = rule.name?.trim()
        if (name) rule.name = name
        else delete rule.name
      }
      this.save(validateRelationshipGuidance(value))
      this.close()
    } catch (error) { this.showError(error) }
  }

  private showError(error: unknown): void { this.messageEl.setText(String(error instanceof Error ? error.message : error)) }

  private renderRules(): void {
    this.flushers.clear()
    this.rulesEl.empty()
    if (!this.guidance.rules.length) {
      this.rulesEl.createDiv({ cls: 'mkls-relation-rules-empty', text: 'No rules yet. Without a matching rule, connections are created as usual.' })
      return
    }
    this.guidance.rules.forEach((rule, index) => this.renderRule(rule, index))
  }

  private renderRule(rule: RelationshipRule, index: number): void {
    const card = this.rulesEl.createDiv({ cls: 'mkls-relation-rule', attr: { 'data-rule': rule.id } })
    const header = card.createDiv({ cls: 'mkls-relation-rule-header' })
    const name = header.createEl('input', { type: 'text', cls: 'mkls-relation-rule-name', attr: { placeholder: `Rule ${index + 1} name (optional)`, 'aria-label': `Rule ${index + 1} name` } })
    name.value = rule.name ?? ''
    name.addEventListener('input', () => { rule.name = name.value })
    const remove = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `Remove rule ${index + 1}` } })
    setIcon(remove, 'trash-2')
    remove.onclick = () => { this.guidance.rules.splice(index, 1); this.renderRules() }

    const body = card.createDiv({ cls: 'mkls-relation-rule-body' })
    this.listField(body, rule, 'from', 'When connecting from', 'card type, e.g. concept', 'nodes')
    this.listField(body, rule, 'to', 'to', 'card type, e.g. example', 'nodes')
    this.listField(body, rule, 'relations', 'offer', 'relationship, e.g. illustrated by', 'edges')
    card.createDiv({ cls: 'mkls-relation-rule-summary' })
    this.renderSummary(card, rule)
  }

  private renderSummaries(): void {
    for (const rule of this.guidance.rules) {
      const card = this.rulesEl.querySelector<HTMLElement>(`[data-rule="${CSS.escape(rule.id)}"]`)
      if (card) this.renderSummary(card, rule)
    }
  }

  private renderSummary(card: HTMLElement, rule: RelationshipRule): void {
    const summary = card.querySelector<HTMLElement>('.mkls-relation-rule-summary')
    if (!summary) return
    const key = this.guidance.nodeTypeKey || 'type'
    summary.setText(rule.from.length && rule.to.length && rule.relations.length
      ? `Connecting a card whose ${key} is ${phrase(rule.from, '…')} to one whose ${key} is ${phrase(rule.to, '…')} suggests ${phrase(rule.relations.map(value => `“${value}”`), '…')}.`
      : 'Add at least one type on each side and one relationship to offer.')
  }

  /** Chip list: Enter or comma adds the typed value, Backspace on an empty field removes the last. */
  private listField(parent: HTMLElement, rule: RelationshipRule, list: ListKey, label: string, placeholder: string, kind: 'nodes' | 'edges'): void {
    const row = parent.createDiv({ cls: 'mkls-relation-rule-line' })
    row.createSpan({ cls: 'mkls-relation-rule-label', text: label })
    const box = row.createDiv({ cls: 'mkls-relation-chips' })
    const datalist = `${this.listId}-${kind}`
    if (this.suggest && !this.contentEl.querySelector(`#${CSS.escape(datalist)}`)) this.contentEl.createEl('datalist', { attr: { id: datalist } })
    const input = createEl('input', { type: 'text', cls: 'mkls-relation-chip-input', attr: { placeholder, 'aria-label': `${label}: add ${kind === 'nodes' ? 'card type' : 'relationship type'}`, 'data-list': list, spellcheck: 'false', ...(this.suggest ? { list: datalist } : {}) } })
    const card = parent.parentElement!
    const renderChips = () => {
      for (const chip of Array.from(box.querySelectorAll('.mkls-relation-chip'))) chip.remove()
      for (const value of rule[list]) {
        const chip = createSpan({ cls: 'mkls-relation-chip' })
        chip.createSpan({ text: value })
        const remove = chip.createEl('button', { cls: 'mkls-relation-chip-remove', attr: { 'aria-label': `Remove ${value}` } })
        setIcon(remove, 'x')
        remove.onclick = () => { rule[list] = rule[list].filter(item => item !== value); renderChips(); input.focus() }
        box.insertBefore(chip, input)
      }
      input.placeholder = rule[list].length ? '' : placeholder
      this.renderSummary(card, rule)
    }
    const add = (): boolean => {
      const values = input.value.split(',').map(value => value.trim()).filter(Boolean)
      input.value = ''
      const next = values.filter(value => !rule[list].includes(value))
      if (!next.length) return false
      rule[list] = [...rule[list], ...new Set(next)]
      renderChips(); return true
    }
    box.appendChild(input)
    box.addEventListener('click', event => { if (event.target === box) input.focus() })
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add() }
      else if (event.key === 'Backspace' && !input.value && rule[list].length) { rule[list] = rule[list].slice(0, -1); renderChips() }
    })
    input.addEventListener('input', () => { if (input.value.includes(',')) add() })
    input.addEventListener('blur', () => { add() })
    input.addEventListener('focus', () => this.fillSuggestions(datalist, kind))
    this.flushers.add(add)
    renderChips()
  }

  private fillSuggestions(id: string, kind: 'nodes' | 'edges'): void {
    const datalist = this.contentEl.querySelector(`#${CSS.escape(id)}`)
    if (!this.suggest || !datalist) return
    datalist.empty()
    let values: string[] = []
    try { values = this.suggest(kind === 'nodes' ? this.guidance.nodeTypeKey : this.guidance.edgeTypeKey, kind) } catch { /* suggestions are optional */ }
    for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b))) datalist.createEl('option', { attr: { value } })
  }
}
