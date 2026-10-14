// Authored by Claude (LLM agent) for the MKLS-maintained fork; see AGENTS.md.
//
// Compact chooser shown after a new connection is dropped on a node whose endpoint types match
// relationship rules. Rules only suggest types: connecting without a type is always offered, and
// cancelling lets the core remove the provisional connection. This module writes nothing; the
// core applies the choice, records history and rechecks revisions.
import { setIcon, type App } from 'obsidian'
import type { Canvas, CanvasNode } from '../@types/Canvas'
import type { RelationChoice } from './types'

export interface RelationChoiceRequest {
  canvas: Canvas
  source: CanvasNode
  target: CanvasNode
  choices: RelationChoice[]
  /** Client (viewport) coordinates of the drop point in the canvas window. */
  position: { x: number; y: number }
  choose: (type: string | undefined) => void
  cancel: () => void
}

const LABEL_LENGTH = 40
let chooserCounter = 0

/** A short readable name for a card: first text line, file or group name, or link. */
export function nodeLabel(node: CanvasNode): string {
  const data = node.getData() as { type?: string; text?: string; file?: string; url?: string; label?: string }
  let label = ''
  if (data.type === 'text') label = (data.text ?? '').split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line && line !== '---') ?? ''
  else if (data.type === 'file') label = (data.file ?? '').split('/').pop()?.replace(/\.md$/, '') ?? ''
  else if (data.type === 'link') label = (data.url ?? '').replace(/^https?:\/\//, '')
  else if (data.type === 'group') label = data.label ?? ''
  if (!label) label = data.type === 'group' ? 'Untitled group' : 'Untitled card'
  return label.length > LABEL_LENGTH ? label.slice(0, LABEL_LENGTH - 1) + '…' : label
}

/** Opens the chooser; the returned disposer closes it without calling cancel. */
export function showRelationChoices(_app: App, request: RelationChoiceRequest): () => void {
  const doc = request.canvas.wrapperEl.doc, win = doc.win
  let open = true
  const titleId = `mkls-relation-chooser-title-${++chooserCounter}`
  const el = doc.body.createDiv({ cls: 'mkls-relation-chooser', attr: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId } })

  const close = () => {
    if (!open) return
    open = false
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('keydown', escape, true)
    win.removeEventListener('blur', blur)
    el.remove()
  }
  // Close first, then hand over, so callbacks see the UI gone and run at most once. When focus was
  // inside the chooser it returns to the canvas rather than staying on the document body; an
  // outside press or window blur leaves focus where the user put it.
  const settle = (action: () => void, restoreFocus: boolean) => {
    if (!open) return
    const focused = restoreFocus && el.contains(doc.activeElement)
    close()
    if (focused) request.canvas.wrapperEl.focus({ preventScroll: true })
    action()
  }
  const cancel = (restoreFocus = true) => settle(request.cancel, restoreFocus)
  const choose = (type: string | undefined) => settle(() => request.choose(type), true)
  const outside = (event: PointerEvent) => { if (!el.contains(event.target as Node | null)) cancel(false) }
  const blur = () => cancel(false)
  // Esc cancels even when focus has left the chooser, before the canvas sees the key.
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }

  const header = el.createDiv({ cls: 'mkls-relation-chooser-header' })
  header.createDiv({ cls: 'mkls-relation-chooser-title', text: 'Choose a relationship', attr: { id: titleId } })
  const ends = header.createDiv({ cls: 'mkls-relation-chooser-ends' })
  ends.createSpan({ cls: 'mkls-relation-chooser-end', text: nodeLabel(request.source) })
  setIcon(ends.createSpan({ cls: 'mkls-relation-chooser-arrow', attr: { 'aria-label': 'to' } }), 'arrow-right')
  ends.createSpan({ cls: 'mkls-relation-chooser-end', text: nodeLabel(request.target) })

  const list = el.createDiv({ cls: 'mkls-relation-chooser-list', attr: { role: 'listbox', 'aria-label': 'Suggested relationship types' } })
  const buttons: HTMLButtonElement[] = []
  request.choices.forEach((choice, index) => {
    const button = list.createEl('button', { cls: 'mkls-relation-choice', attr: { role: 'option', 'aria-selected': 'false' } })
    if (index < 9) button.createSpan({ cls: 'mkls-relation-choice-key', text: String(index + 1), attr: { 'aria-hidden': 'true' } })
    const text = button.createSpan({ cls: 'mkls-relation-choice-text' })
    text.createSpan({ cls: 'mkls-relation-choice-type', text: choice.type })
    const names = choice.ruleNames.filter(name => name.trim())
    const unnamed = choice.ruleIds.length - names.length
    const from = [...names, ...(unnamed > 0 ? [unnamed === 1 ? 'an unnamed rule' : `${unnamed} unnamed rules`] : [])]
    if (from.length) text.createSpan({ cls: 'mkls-relation-choice-rule', text: 'From ' + from.join(', ') })
    button.onclick = () => choose(choice.type)
    buttons.push(button)
  })

  el.createDiv({ cls: 'mkls-relation-chooser-note', text: 'Suggested by this canvas’s relationship rules. You can also connect without a type.' })
  const footer = el.createDiv({ cls: 'mkls-relation-chooser-footer' })
  const untyped = footer.createEl('button', { text: 'Connect without type' })
  untyped.onclick = () => choose(undefined)
  const dismiss = footer.createEl('button', { text: 'Cancel', attr: { 'aria-label': 'Cancel and remove the new connection' } })
  dismiss.onclick = () => cancel()
  const focusable = [...buttons, untyped, dismiss]

  const focus = (index: number) => {
    const target = focusable[(index + focusable.length) % focusable.length]
    target.focus()
    for (const button of buttons) button.setAttribute('aria-selected', String(button === target))
  }
  // Keys never reach the canvas while the chooser is open.
  el.addEventListener('keydown', event => {
    event.stopPropagation()
    const index = focusable.indexOf(doc.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
    else if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) { event.preventDefault(); focus(index + 1) }
    else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) { event.preventDefault(); focus(index - 1) }
    else if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const choice = request.choices[Number(event.key) - 1]
      if (choice) { event.preventDefault(); choose(choice.type) }
    }
  })
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel', 'keyup']) el.addEventListener(type, event => event.stopPropagation())

  // Place at the drop point, kept inside the window.
  const margin = 8, rect = el.getBoundingClientRect()
  const x = Math.max(margin, Math.min(request.position.x, win.innerWidth - rect.width - margin))
  const below = request.position.y + 12
  const y = below + rect.height + margin <= win.innerHeight ? below : Math.max(margin, request.position.y - rect.height - 12)
  el.style.left = `${x}px`; el.style.top = `${y}px`

  // The connecting pointerup may still be dispatching; listen for outside presses afterwards.
  win.setTimeout(() => {
    if (!open) return
    doc.addEventListener('pointerdown', outside, true)
    doc.addEventListener('keydown', escape, true)
    win.addEventListener('blur', blur)
    focus(0)
  }, 0)
  return close
}
