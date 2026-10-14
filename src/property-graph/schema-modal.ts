// Authored by Codex (LLM agent). Guided schema editing, with exact typed defaults.
import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import type { CanvasPropertySchema, ElementSchema, PropertyValue, SchemaField, SchemaFieldType } from './types'
import { validateSchema } from './schema'

interface FieldDraft { field: SchemaField; hasDefault: boolean; defaultValue: unknown; defaultJSON?: string; optionsText: string }
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key) === true
const labels: Record<SchemaFieldType, string> = { text: 'Text', number: 'Number', boolean: 'Checkbox', date: 'Date', list: 'List', object: 'Object' }

export default class SchemaModal extends Modal {
  private schema: CanvasPropertySchema
  private fields: Record<'nodes' | 'edges', FieldDraft[]>
  private kind: 'nodes' | 'edges' = 'nodes'
  private editor!: HTMLElement
  private message!: HTMLElement
  constructor(app: App, current: CanvasPropertySchema | undefined, private saveSchema: (schema: CanvasPropertySchema) => void, private removeSchema?: () => void) {
    super(app)
    this.schema = current ? JSON.parse(JSON.stringify(current)) as CanvasPropertySchema : { version: 1, nodes: { fields: [], allowAdditional: true }, edges: { fields: [], allowAdditional: true } }
    const drafts = (definition: ElementSchema): FieldDraft[] => definition.fields.map(field => ({ field, hasDefault: owns(field, 'default'), defaultValue: field.default, optionsText: field.options ? JSON.stringify(field.options, null, 2) : '' }))
    this.fields = { nodes: drafts(this.schema.nodes), edges: drafts(this.schema.edges) }
  }
  onOpen(): void {
    this.titleEl.setText('Canvas property schema')
    this.contentEl.addClass('mkls-schema-editor')
    this.contentEl.createEl('p', { text: 'Predefine fields separately for nodes and edges. Existing properties stay unchanged. Defaults are applied only when requested.' })
    const tabs = new Setting(this.contentEl).setName('Fields for')
    tabs.addButton(button => button.setButtonText('Nodes').onClick(() => { this.kind = 'nodes'; this.render() }))
    tabs.addButton(button => button.setButtonText('Edges').onClick(() => { this.kind = 'edges'; this.render() }))
    this.editor = this.contentEl.createDiv({ cls: 'mkls-schema-fields' })
    this.message = this.contentEl.createEl('p', { cls: 'mkls-schema-error', attr: { role: 'alert' } })
    const actions = new Setting(this.contentEl)
    if (this.removeSchema) actions.addButton(button => button.setButtonText('Remove schema').setTooltip('Keeps all element properties and saved views').onClick(() => {
      try { this.removeSchema!(); this.close() } catch (error) { this.showError(error) }
    }))
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
    actions.addButton(button => button.setButtonText('Save schema').setCta().onClick(() => {
      try {
        for (const kind of ['nodes', 'edges'] as const) this.schema[kind].fields = this.fields[kind].map(draft => {
          const field = { ...draft.field }
          delete field.default; delete field.options
          if (draft.hasDefault) field.default = draft.defaultJSON === undefined ? draft.defaultValue as PropertyValue : JSON.parse(draft.defaultJSON) as PropertyValue
          if (draft.optionsText.trim()) field.options = JSON.parse(draft.optionsText) as PropertyValue[]
          return field
        })
        this.saveSchema(validateSchema(this.schema)); this.close()
      } catch (error) { this.showError(error) }
    }))
    this.render()
  }
  private showError(error: unknown): void { this.message.setText(String(error instanceof Error ? error.message : error)) }
  private render(): void {
    this.editor.empty()
    this.editor.createEl('h3', { text: this.kind === 'nodes' ? 'Node properties' : 'Edge properties' })
    const definition = this.schema[this.kind]
    new Setting(this.editor).setName('Allow additional properties').setDesc('Let elements use fields beyond this list. Turning this off preserves existing values but reports them as schema errors.').addToggle(toggle => toggle.setValue(definition.allowAdditional).onChange(value => { definition.allowAdditional = value }))
    for (const draft of this.fields[this.kind]) this.renderField(draft)
    new Setting(this.editor).addButton(button => button.setButtonText('Add field').onClick(() => {
      this.fields[this.kind].push({ field: { key: '', type: 'text' }, hasDefault: false, defaultValue: undefined, optionsText: '' }); this.render()
      const cards = this.editor.querySelectorAll<HTMLElement>('.mkls-schema-field')
      cards[cards.length - 1]?.querySelector<HTMLInputElement>('input')?.focus()
    }))
  }
  private renderField(draft: FieldDraft): void {
    const field = draft.field, container = this.editor.createDiv({ cls: 'mkls-schema-field' })
    const title = new Setting(container).setName('Property')
    title.addText(input => input.setPlaceholder('Property name').setValue(field.key).onChange(value => { field.key = value }))
    title.addDropdown(dropdown => {
      for (const [type, label] of Object.entries(labels)) dropdown.addOption(type, label)
      dropdown.setValue(field.type).onChange(value => {
        field.type = value as SchemaFieldType
        // Keep an existing default; a type change must not silently coerce it.
        this.render()
      })
    })
    title.addButton(button => button.setIcon('trash-2').setTooltip('Remove this field from the schema; element values are kept').onClick(() => { this.fields[this.kind] = this.fields[this.kind].filter(item => item !== draft); this.render() }))
    new Setting(container).setName('Description').addText(input => input.setPlaceholder('Help for this property').setValue(field.description ?? '').onChange(value => { field.description = value }))
    new Setting(container).setName('Required').setDesc('The property must exist. Zero, false and empty text are values.').addToggle(toggle => toggle.setValue(field.required === true).onChange(value => { field.required = value }))
    new Setting(container).setName('Allow null').setDesc('Null is separate from an absent property.').addToggle(toggle => toggle.setValue(field.nullable === true).onChange(value => { field.nullable = value }))
    new Setting(container).setName('Suggest a default').setDesc('Offers an action to apply this value in the property editor.').addToggle(toggle => toggle.setValue(draft.hasDefault).onChange(value => {
      draft.hasDefault = value
      if (value && draft.defaultValue === undefined) draft.defaultValue = field.type === 'boolean' ? false : field.type === 'number' ? 0 : field.type === 'list' ? [] : field.type === 'object' ? {} : ''
      this.render()
    }))
    if (draft.hasDefault) this.renderDefault(container, draft)
    new Setting(container).setName('Allowed values').setDesc('Optional JSON list, e.g. ["accepted", "provisional"] or [0, 1]. Leave blank to allow any value of this type.').addTextArea(input => input.setValue(draft.optionsText).onChange(value => { draft.optionsText = value }))
  }
  private renderDefault(container: HTMLElement, draft: FieldDraft): void {
    const field = draft.field
    let value = draft.defaultValue
    if (draft.defaultJSON !== undefined) { try { value = JSON.parse(draft.defaultJSON) as unknown } catch { value = draft.defaultJSON } }
    const assign = (value: unknown) => { draft.defaultValue = value; delete draft.defaultJSON }
    const setting = new Setting(container).setName('Default value')
    if (value === null) {
      setting.setDesc('Current default is null.').addButton(button => button.setButtonText('Use a typed value').onClick(() => { assign(field.type === 'boolean' ? false : field.type === 'number' ? 0 : field.type === 'list' ? [] : field.type === 'object' ? {} : ''); this.render() }))
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') setting.setDesc('Existing default has a different type; choose true or false to replace it.')
      setting.addToggle(toggle => toggle.setValue(value === true).onChange(value => assign(value)))
    } else if (field.type === 'list' || field.type === 'object') {
      setting.setDesc('JSON value').addTextArea(input => input.setValue(draft.defaultJSON ?? JSON.stringify(value, null, 2) ?? '').onChange(value => { draft.defaultJSON = value }))
    } else {
      setting.addText(input => {
        const displayed = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : value == null ? '' : JSON.stringify(value) ?? ''
        input.setValue(displayed).onChange(value => assign(field.type === 'number' && value.trim() ? Number(value) : value))
        input.inputEl.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
        if (field.type === 'number') input.inputEl.step = 'any'
      })
    }
    if (field.nullable && value !== null) setting.addButton(button => button.setButtonText('Use null').onClick(() => { assign(null); this.render() }))
  }
  onClose(): void { this.contentEl.empty() }
}
