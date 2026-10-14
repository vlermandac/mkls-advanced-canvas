// Authored by Codex (LLM agent). Recovery must never silently revive consumed edits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DraftStore } from '../src/property-graph/drafts'
function storage() {
  const files = new Map<string,string>()
  const adapter = { exists: async (path: string) => files.has(path), mkdir: async (path: string) => { files.set(path,'') }, read: async (path: string) => files.get(path)!, write: async (path: string,data: string) => { files.set(path,data) } }
  return {files, adapter}
}
const draft = { file:'canvas.canvas',id:'one',source:'---\nx: 1\n---\nDraft body',revision:'original',savedAt:'2026-10-12T00:00:00Z' }
test('draft identity, consumption and disk recovery preserve explicit intent',async()=>{
  const {files,adapter}=storage();const store=new DraftStore(adapter,'recovery')
  await store.save(draft);assert.deepEqual(await store.read(draft.file,draft.id),draft)
  assert.equal(await store.read('other.canvas',draft.id),undefined)
  assert.deepEqual(await new DraftStore(adapter,'recovery').read(draft.file,draft.id),draft)
  const consume=store.consume(draft.file,draft.id)
  assert.equal(await store.read(draft.file,draft.id),undefined)
  await consume;assert.equal(await new DraftStore(adapter,'recovery').read(draft.file,draft.id),undefined)
  const archive=[...files].find(([path])=>path.endsWith('.history.json'))!
  assert.deepEqual(JSON.parse(archive[1]),[draft])
})
test('archive bounded at 20 versions, latest YAML-only draft retains kind',async()=>{
  const {files,adapter}=storage();const store=new DraftStore(adapter,'recovery')
  for(let i=0;i<30;i++)await store.save({...draft,source:'x: '+i,kind:'yaml'})
  const history=JSON.parse([...files].find(([path])=>path.endsWith('.history.json'))![1]) as {source:string}[]
  assert.equal(history.length,20);assert.equal(history[0].source,'x: 10')
  assert.equal((await new DraftStore(adapter,'recovery').read(draft.file,draft.id))?.kind,'yaml')
})
test('malformed latest recovery pointer is ignored without changing disk bytes',async()=>{
  const {files,adapter}=storage();const store=new DraftStore(adapter,'recovery')
  await store.save(draft);const path=[...files.keys()].find(p=>p.endsWith('.json')&&!p.endsWith('.history.json'))!
  files.set(path,'not JSON');assert.equal(await new DraftStore(adapter,'recovery').read(draft.file,draft.id),undefined)
  assert.equal(files.get(path),'not JSON')
})
