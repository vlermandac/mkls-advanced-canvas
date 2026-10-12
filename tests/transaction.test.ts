// Authored by Codex (LLM agent). Native-reference history and rollback regressions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Canvas } from '../src/@types/Canvas'
import { canvasTransaction, deferElementSave, isTransactionActive } from '../src/property-graph/transaction'

function fixture() {
  let live = { metadata: { version: '1.0-1.0', frontmatter: {}, propertyGraph: { version: 1, views: [] as { name: string }[] } }, nodes: [{ id: 'a', text: 'original' }], edges: [] }
  let saves = 0
  const history = { data: [live], current: 0 }
  const canvas = {
    getData: () => ({ ...live, nodes: live.nodes.map(node => ({ ...node })) }),
    setData: (data: typeof live) => { live = data; history.data.push(data); history.current++ },
    importData: () => {},
    get metadata() { return live.metadata },
    history, view: { requestSave: () => saves++ },
    pushHistory: (data: typeof live) => { history.data.push(data); history.current++ }
  } as unknown as Canvas
  return { canvas, history, live: () => live, saves: () => saves }
}
test('metadata edits freeze historical roots without detaching live data', () => {
  const f = fixture()
  canvasTransaction(f.canvas, () => { f.canvas.metadata.propertyGraph = { version: 1, views: [{ id: 'v', name: 'first', mode: 'nodes' }] } }, true, true)
  assert.equal(f.live().metadata.propertyGraph.views[0].name, 'first')
  assert.deepEqual(f.history.data[0].metadata.propertyGraph.views, [])
  canvasTransaction(f.canvas, () => { f.canvas.metadata.propertyGraph = { version: 1, views: [{ id: 'v', name: 'second', mode: 'nodes' }] } }, true, true)
  assert.equal(f.history.data[1].metadata.propertyGraph.views[0].name, 'first')
  assert.equal(f.live().metadata.propertyGraph.views[0].name, 'second')
  assert.equal(f.saves(), 2)
})
test('no-op and nested actions produce only the observable logical edit', () => {
  const f = fixture()
  canvasTransaction(f.canvas, () => {})
  assert.equal(f.saves(), 0); assert.equal(f.history.data.length, 1)
  canvasTransaction(f.canvas, () => {
    assert.equal(isTransactionActive(f.canvas), true)
    assert.equal(deferElementSave(f.canvas, true), true)
    canvasTransaction(f.canvas, () => { f.live().nodes[0].text = 'changed' })
  })
  assert.equal(f.saves(), 1); assert.equal(f.history.data.length, 2)
  assert.equal(isTransactionActive(f.canvas), false)
})
test('a failed transaction restores graph and exact history position', () => {
  const f = fixture()
  assert.throws(() => canvasTransaction(f.canvas, () => { f.live().nodes[0].text = 'bad'; throw Error('failure') }), /failure/)
  assert.equal(f.live().nodes[0].text, 'original')
  assert.equal(f.history.data.length, 1); assert.equal(f.history.current, 0)
  assert.equal(isTransactionActive(f.canvas), false)
})
