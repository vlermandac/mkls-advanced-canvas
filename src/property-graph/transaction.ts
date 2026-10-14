// Authored by Codex (LLM agent). One native history/save boundary per logical edit.
import type { Canvas } from '../@types/Canvas'
interface Transaction { depth: number; changed: boolean; history: boolean }
const active = new WeakMap<Canvas, Transaction>()
export function isTransactionActive(canvas: Canvas): boolean { return active.has(canvas) }
export function deferElementSave(canvas: Canvas, history = false): boolean {
  const transaction = active.get(canvas)
  if (!transaction) return false
  transaction.changed = true; transaction.history ||= history
  return true
}
export function canvasTransaction<T>(canvas: Canvas, operation: () => T, history = true, metadataWrite = false): T {
  const enclosing = active.get(canvas)
  if (enclosing) { enclosing.depth++; try { return operation() } finally { enclosing.depth-- } }
  const initial = canvas.getData()
  const beforeString = JSON.stringify(initial)
  // Native history keeps snapshots by reference. Freeze shared metadata before a
  // canvas-level assignment so earlier saved-view definitions remain undoable.
  if (metadataWrite) {
    const frozen = initial.metadata === undefined ? undefined : JSON.parse(JSON.stringify(initial.metadata)) as typeof initial.metadata
    canvas.history.data = (canvas.history.data as ReturnType<Canvas['getData']>[]).map(entry => entry.metadata === initial.metadata ? { ...entry, metadata: frozen } : entry)
  }
  const historyBefore = canvas.history.data.slice(); const historyPosition = canvas.history.current
  const transaction: Transaction = { depth: 1, changed: false, history }
  active.set(canvas, transaction)
  try {
    const result = operation()
    active.delete(canvas)
    const after = canvas.getData()
    const serialized = JSON.stringify(after)
    if (beforeString !== serialized) {
      Reflect.set(canvas, 'data', after) // Keep native serializer cache coherent with live Maps.
      if (history) canvas.pushHistory(JSON.parse(serialized) as typeof after)
      canvas.view.requestSave()
    }
    return result
  } catch (error) {
    if (JSON.stringify(canvas.getData()) === beforeString) { canvas.history.data = historyBefore; canvas.history.current = historyPosition; throw error }
    // Roll back through setData so native indices, metadata and extension hooks agree.
    canvas.setData(JSON.parse(beforeString) as ReturnType<Canvas['getData']>)
    // Native setData assigns its data root after import hooks run. Rebind the
    // metadata proxy/index to the restored root, as the native undo adapter does.
    canvas.importData(canvas.getData(), true)
    canvas.history.data = historyBefore; canvas.history.current = historyPosition
    active.delete(canvas)
    canvas.view.requestSave()
    throw error
  } finally { active.delete(canvas) }
}
