// Authored by Codex (LLM agent). History restoration must not mutate source snapshots.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {CanvasData} from '../src/@types/AdvancedJsonCanvas'
import {canonicalHistory} from '../src/utils/canonical-history'
test('normal history entries keep identity and avoid full cloning',()=>{
 const data={nodes:[],edges:[],metadata:{version:'1.0-1.0',frontmatter:{}}} as CanvasData
 assert.equal(canonicalHistory(data,()=>{throw Error('unnecessary transform')}),data)
})
test('projection normalization copies mutated arrays and preserves prior history',()=>{
 const data={metadata:{version:'1.0-1.0',frontmatter:{}},nodes:[{id:'host',type:'file',file:'source.canvas',x:0,y:0,width:200,height:200,isPortalLoaded:true,interdimensionalEdges:[]},{id:'acportal||host||inner',type:'text',text:'foreign',x:0,y:0,width:200,height:100}],edges:[{id:'edge',fromNode:'other',toNode:'acportal||host||inner'}]} as unknown as CanvasData
 const before=JSON.stringify(data)
 const next=canonicalHistory(data,copy=>{
  const host=copy.nodes[0] as typeof copy.nodes[0]&{isPortalLoaded?:boolean;interdimensionalEdges:unknown[]};delete host.isPortalLoaded;host.interdimensionalEdges.push(copy.edges[0]);copy.edges=[];copy.nodes=[host]
 })
 assert.equal(JSON.stringify(data),before);assert.equal(next.nodes.length,1);assert.notEqual(next.nodes[0],data.nodes[0]);assert.equal(next.metadata,data.metadata)
})
