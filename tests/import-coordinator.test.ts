// Authored by Codex (LLM agent). Deferred updates have a canvas and revision identity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ImportCoordinator } from '../src/utils/import-coordinator'
test('a completed import allows its callback until a later edit or import',()=>{
  const guard=new ImportCoordinator(),canvas={};const first=guard.begin(canvas)
  assert.equal(guard.allows(canvas,first),false);guard.changed(canvas);guard.finish(canvas,first)
  assert.equal(guard.allows(canvas,first),true);guard.changed(canvas);assert.equal(guard.allows(canvas,first),false)
  const second=guard.begin(canvas);guard.finish(canvas,second);assert.equal(guard.allows(canvas,second),true)
  const third=guard.begin(canvas);guard.finish(canvas,third);assert.equal(guard.allows(canvas,second),false)
  assert.equal(guard.allows(canvas,third),true)
})
test('activity in another canvas cannot invalidate this window import',()=>{
  const guard=new ImportCoordinator(),one={},two={};const ticket=guard.begin(one);guard.finish(one,ticket)
  const other=guard.begin(two);guard.changed(two);guard.finish(two,other)
  assert.equal(guard.allows(one,ticket),true)
})
test('nested empty additive imports do not cancel pending projections',()=>{
  const guard=new ImportCoordinator(),canvas={};const outer=guard.begin(canvas)
  const empty=guard.begin(canvas,false);guard.finish(canvas,empty);guard.finish(canvas,outer)
  assert.equal(guard.allows(canvas,outer),true)
  const extra=guard.begin(canvas);guard.changed(canvas);guard.finish(canvas,extra)
  assert.equal(guard.allows(canvas,outer),false)
})
