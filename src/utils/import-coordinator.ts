// Authored by Codex (LLM agent). Deferred imports must not overwrite later edits.
interface State { generation: number; revision: number }
export interface ImportTicket { generation: number; revision?: number }
export class ImportCoordinator {
  private states = new WeakMap<object, State>()
  private state(key: object): State { let state = this.states.get(key); if (!state) this.states.set(key, state = { generation: 0, revision: 0 }); return state }
  begin(key: object, replacesOrAddsData = true): ImportTicket { const state = this.state(key); if (replacesOrAddsData) state.generation++; return { generation: state.generation } }
  changed(key: object): void { this.state(key).revision++ }
  currentRevision(key: object): number { return this.state(key).revision }
  finish(key: object, ticket: ImportTicket): void { ticket.revision = this.state(key).revision }
  allows(key: object, ticket: ImportTicket): boolean { const state = this.state(key); return ticket.generation === state.generation && ticket.revision === state.revision }
}
export const canvasImports = new ImportCoordinator()
