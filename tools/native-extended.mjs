// Authored by Codex (LLM agent). Retained native preservation/lifecycle checks.
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const vault = resolve(process.argv[2] ?? '');
const output = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3] || !basename(vault).includes('QA') || existsSync(output)) throw Error('Use an isolated QA vault and a new report path');
const fixture = 'Extended-' + Date.now() + '.canvas';
writeFileSync(resolve(vault, 'Instance QA.md'), '---\noriginal: true\n---\nLinked body, unchanged.\n');
const node = (id, type, x, y, rest={}) => ({id,type,x,y,width:200,height:100,...rest});
writeFileSync(resolve(vault,'Portal Source.canvas'),JSON.stringify({nodes:[node('inner','text',0,0,{text:'Source inner',propertyGraph:{version:1,yaml:'source: immutable\n'}})],edges:[]}));
writeFileSync(resolve(vault, fixture), JSON.stringify({metadata:{version:'1.0-1.0',frontmatter:{},propertyGraph:{version:1,views:[]}},nodes:[
  node('g','group',0,0,{width:750,height:450,label:'Group',propertyGraph:{version:1,yaml:'status: accepted\n'}}),
  node('a','text',40,70,{text:'Body A',propertyGraph:{version:1,yaml:'status: accepted\nlink: "[[Opaque]]"\n'}}),
  node('b','text',300,70,{text:'Body B',propertyGraph:{version:1,yaml:'status: provisional\n'}}),
  node('f1','file',900,0,{file:'Instance QA.md'}),node('f2','file',1150,0,{file:'Instance QA.md'}),
  node('l','link',900,200,{url:'https://example.com'}),
  node('legacy','text',1150,200,{text:'---\nkind: theorem\nref: "[[Foo|bar]]"\n---\n$A$'}),
  node('p','file',900,500,{file:'Portal Source.canvas',portal:true,propertyGraph:{version:1,yaml:'status: accepted\n'}})
],edges:[{id:'ab',fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',label:'uses',propertyGraph:{version:1,yaml:'kind: dependency\n'}}]},null,2));
async function run({vault,fixture}) {
  const fs=require('fs');
  if(app.vault.adapter.getBasePath()!==vault)throw Error('Wrong vault');
  const p=app.plugins.getPlugin('mkls-advanced-canvas');
  let c;for(let i=0;i<100;i++){c=p.getCurrentCanvas();if(c?.view.file?.path===fixture)break;await new Promise(r=>setTimeout(r,50))}
  if(c?.view.file?.path!==fixture)throw Error('Wrong fixture');
  const ext=p.canvasExtensions.find(e=>e.constructor.name==='PropertyGraphCanvasExtension');
  window.electronWindow?.webContents.focus();c.wrapperEl.focus();
  const checks=[];globalThis.__mklsExtendedChecks=checks;
  const check=(name,ok,details)=>{checks.push({name,passed:!!ok,details});if(!ok)throw Error(name)};
  const wait=(ms=100)=>new Promise(r=>setTimeout(r,ms));
  const data=id=>(c.nodes.get(id)??c.edges.get(id)).getData();
  const cmd=id=>app.commands.executeCommandById('mkls-advanced-canvas:'+id);
  const modal=async id=>{c.selectOnly(c.nodes.get(id));await ext.openSource(c);await wait();return document.querySelector('.mkls-source-editor')};
  const save=()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Save').click();
  const close=()=>document.querySelector('.modal-header-button, .modal-close-button').click();
  const original=fs.readFileSync(vault+'/Instance QA.md','utf8');
  const portalOriginal=fs.readFileSync(vault+'/Portal Source.canvas','utf8');
  for(let i=0;i<100&&!c.nodes.has('acportal||p||inner');i++)await wait(50);
  check('portal projection imported with source properties',data('acportal||p||inner').propertyGraph.yaml==='source: immutable\n');
  const legacy=data('legacy').text;c.selectOnly(c.nodes.get('legacy'));const adoptionHistory=c.history.data.length;cmd('adopt-node-frontmatter');await wait();
  check('legacy adoption explicit and one history action',data('legacy').text==='$A$'&&data('legacy').propertyGraph.yaml.includes('[[Foo|bar]]')&&c.history.data.length===adoptionHistory+1);
  c.undo();await wait();check('adoption undo restores original raw source',data('legacy').text===legacy&&data('legacy').propertyGraph===undefined);
  for(const [id,yaml] of [['f1','instance: first\n'],['f2','instance: second\n'],['l','kind: website\n'],['g','status: accepted\nkind: section\n']]){
    const editor=await modal(id);editor.value='---\n'+yaml+'---\n'+(id==='g'?'Group':'');save();await wait();
    check(id+' instance properties persist',data(id).propertyGraph?.yaml===yaml,data(id));
  }
  check('two instances do not alter linked note',fs.readFileSync(vault+'/Instance QA.md','utf8')===original);
  let editor=await modal('a');editor.value='---\nstatus: accepted\n---\nCancelled recovery';close();await wait(150);
  check('cancel does not alter canonical body',data('a').text==='Body A');
  editor=await modal('a');check('cancelled source recovered',editor.value.includes('Cancelled recovery'));
  c.nodes.get('a').setData({...data('a'),text:'Newer body'},true);save();await wait();
  check('stale modal cannot overwrite newer body',data('a').text==='Newer body'&&!!document.querySelector('.mkls-source-editor'));close();await wait();
  editor=await modal('a');check('stale recovery shows current body',editor.value.endsWith('Newer body'));
  editor.value='---\nstatus: accepted\n---\nSaved source body';const h=c.history.data.length;save();await wait();
  check('source save body and YAML one undo',data('a').text==='Saved source body'&&c.history.data.length===h+1);
  c.undo();await wait();check('source undo restores newer body',data('a').text==='Newer body');c.redo();await wait();
  const committedYaml=data('a').propertyGraph.yaml;c.nodes.get('a').setIsEditing(true);await wait();
  let invalid=c.nodes.get('a').nodeEl.querySelector('.mkls-frontmatter-text');invalid.focus();await wait();invalid.value='broken: [\n';invalid.blur();c.nodes.get('a').setIsEditing(false);await wait();
  check('invalid inline YAML retained without replacing committed properties',data('a').propertyGraph.draft==='broken: [\n'&&data('a').propertyGraph.yaml===committedYaml);
  c.undo();await wait();check('invalid draft undo restores committed record',data('a').propertyGraph.draft===undefined&&data('a').propertyGraph.yaml===committedYaml);
  // A reload retains a panel privately rather than overwriting an incoming body.
  c.nodes.get('a').setIsEditing(true);await wait();let panel=c.nodes.get('a').nodeEl.querySelector('.mkls-frontmatter-text');panel.value='retained: draft\n';
  c.importData({nodes:[],edges:[]},false);await wait();check('additive import preserves active YAML panel',ext.states.get(c).panels.get(c.nodes.get('a'))===panel&&panel.value==='retained: draft\n');
  const reload=c.getData();reload.nodes.find(n=>n.id==='a').text='Reloaded body';c.importData(reload,true);await wait(150);
  check('reload replaces stale property panel',![...ext.states.get(c).panels.values()].includes(panel));
  editor=await modal('a');check('reload recovery cannot replace new body',editor.value.endsWith('Reloaded body'));
  [...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Load retained draft').click();
  check('inline recovery loads YAML without stale body',editor.value.includes('retained: draft')&&editor.value.endsWith('Reloaded body'));close();
  check('label hook registry bounded after reload',ext.states.get(c).labelDisposers.size===c.edges.size);
  const accepted={id:'accepted',name:'Accepted',mode:'nodes',nodes:{kind:'condition',scope:'properties',path:['status'],operator:'equals',value:'accepted'}};
  ext.saveView(c,accepted);await wait();
  const projection=c.nodes.get('acportal||p||inner');check('portal contents follow visible local host',!projection.nodeEl.classList.contains('mkls-view-hidden'));
  const host=data('p');c.nodes.get('p').setData({...host,propertyGraph:{version:1,yaml:'status: provisional\n'}});await wait();
  check('hidden portal host also hides its projection',projection.nodeEl.classList.contains('mkls-view-hidden'));c.nodes.get('p').setData(host);await wait();
  check('filtered containment keeps hidden group members',c.getContainingNodes(c.nodes.get('g').getBBox()).some(n=>n.id==='b'));
  const before={a:{x:data('a').x,y:data('a').y},b:{x:data('b').x,y:data('b').y}};
  c.selectOnly(c.nodes.get('g'));
  const methods={posFromEvt:c.posFromEvt,canSnap:c.canSnap,handleDragWithPan:c.handleDragWithPan};
  try{
    c.posFromEvt=e=>({x:e.clientX,y:e.clientY});c.canSnap=()=>false;
    c.handleDragWithPan=(e,h)=>{const move={clientX:40,clientY:30,shiftKey:false,ctrlKey:false};h.move(move);h.end(move);return ()=>{}};
    c.handleSelectionDrag({clientX:0,clientY:0},null,c.nodes.get('g'));
  }finally{Object.assign(c,methods)}
  await wait();check('native group drag moves hidden member',data('a').x-before.a.x===40&&data('b').x-before.b.x===40&&data('b').y-before.b.y===30,{before,a:data('a'),b:data('b')});
  c.view.setEphemeralState({subpath:'#b'});await wait();
  check('stable navigation reveals hidden ID using All',c.selection.has(c.nodes.get('b'))&&!ext.states.get(c).active);
  const full=JSON.stringify(c.getData());const selected=new Set([c.nodes.get('a'),c.nodes.get('b')]);
  const copied=c.getSelectionData(selected),cloned=c.cloneData(copied,{x:0,y:700});
  c.importData(cloned,false);await wait();
  check('native duplicate remaps IDs and preserves properties',cloned.nodes.every(n=>n.id!=='a'&&n.id!=='b'&&n.propertyGraph)&&cloned.edges[0]?.propertyGraph?.yaml==='kind: dependency\n',cloned);
  check('duplicate leaves original properties unchanged',data('a').propertyGraph.yaml.includes('status: accepted'));
  ext.setView(c,'accepted');await wait();c.selectOnly(c.nodes.get('a'));c.pushHistory(JSON.parse(JSON.stringify(c.getData())));
  c.deleteSelection();await wait(500);
  check('visible deletion removes hidden incident edge',!c.nodes.has('a')&&!c.edges.has('ab'));
  c.undo();await wait();check('deletion undo restores hidden incident edge',c.nodes.has('a')&&c.edges.has('ab'));
  ext.setView(c,'accepted');await wait();cmd('duplicate-property-view');await wait();
  [...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Save view').click();await wait();
  check('duplicate view works with omitted edge predicate',c.metadata.propertyGraph.views.some(v=>v.id!=='accepted'&&v.name==='Accepted copy')&&!document.querySelector('.mkls-filter-editor'));
  ext.setView(c,'accepted');await wait();const expectedIds=[...ext.states.get(c).visible.nodes].sort();cmd('export-property-view');await wait(500);
  const exported=app.vault.getFiles().filter(f=>f.path.startsWith(fixture.replace('.canvas','')+'-view-')).sort((a,b)=>b.path.localeCompare(a.path))[0];
  const exportData=JSON.parse(await app.vault.read(exported));check('current-view export includes only matching IDs and valid endpoints',JSON.stringify(exportData.nodes.map(n=>n.id).sort())===JSON.stringify(expectedIds)&&exportData.edges.every(e=>exportData.nodes.some(n=>n.id===e.fromNode)&&exportData.nodes.some(n=>n.id===e.toNode)));
  ext.setView(c);await wait();
  c.selectOnly(c.nodes.get('g'));cmd('toggle-collapse-group');await wait();const collapsed=c.getData();
  check('collapsed group preserves hidden-member YAML in canonical save',!c.nodes.has('b')&&collapsed.nodes.find(n=>n.id==='b').propertyGraph.yaml==='status: provisional\n');
  c.selectOnly(c.nodes.get('g'));cmd('toggle-collapse-group');await wait();check('expanding group restores element properties',data('b').propertyGraph.yaml==='status: provisional\n');
  for(let i=0;i<100&&!c.nodes.has('acportal||p||inner');i++)await wait(50);
  check('portal projection returns after group import',c.nodes.has('acportal||p||inner'));
  c.selection=new Set([c.nodes.get('acportal||p||inner')]);await ext.openSource(c);await wait();
  check('portal source properties cannot be edited in projection',!document.querySelector('.mkls-source-editor')&&fs.readFileSync(vault+'/Portal Source.canvas','utf8')===portalOriginal);
  c.selectOnly(c.nodes.get('a'));cmd('export-property-view');await wait(500);
  check('explicit All export contains complete records',app.vault.getFiles().some(f=>f.path.startsWith(fixture.replace('.canvas','')+'-view-')));
  const config=c.metadata.propertyGraph;c.metadata.propertyGraph={version:99,views:[{opaque:true}]};
  const unknown=JSON.stringify(c.metadata.propertyGraph);ext.saveView(c,accepted);await wait();check('unknown view version preserved',JSON.stringify(c.metadata.propertyGraph)===unknown);
  c.metadata.propertyGraph=config;
  const existing=data('a');c.nodes.get('a').setData({...existing,propertyGraph:{version:99,yaml:'future: true\n'}});c.nodes.get('a').setIsEditing(true);await wait();
  panel=c.nodes.get('a').nodeEl.querySelector('.mkls-frontmatter-text');panel.value='edited: true\n';panel.blur();c.nodes.get('a').setIsEditing(false);await wait();
  check('unknown element version preserved on edit',data('a').propertyGraph.version===99&&data('a').propertyGraph.yaml==='future: true\n');
  c.nodes.get('a').setData(existing);c.view.requestSave();await wait(600);
  const expected=JSON.parse(await app.vault.read(c.view.file));c.view.setViewData(JSON.stringify(expected),false);await wait();
  check('disk reopen retains per-instance properties and views',data('f1').propertyGraph.yaml==='instance: first\n'&&data('f2').propertyGraph.yaml==='instance: second\n'&&c.metadata.propertyGraph.views.some(v=>v.id==='accepted'));
  await app.metadataCache.computeFileMetadataAsync(c.view.file);
  const reference=app.metadataCache.getFileCache(c.view.file)?.embeds?.find(e=>e.position.nodeId==='f2');
  check('file backlink cache carries stable element ID',!!reference);
  const order=c.nodes;c.nodes=new Map([...c.nodes].reverse());ext.setView(c,'accepted');
  c.view.setEphemeralState({match:{matches:[[reference.position.start.offset,reference.position.end.offset]]}});await wait();
  check('cached backlink selects original ID after live reordering',c.selection.has(c.nodes.get('f2'))&&!ext.states.get(c).active);c.nodes=order;
  // Native geometry updates bypass setData; the retained index must still update.
  const threshold=data('b').x+20;
  ext.saveView(c,{id:'geometry',name:'Geometry',mode:'nodes',nodes:{kind:'condition',scope:'native',path:['x'],operator:'gt',value:threshold}});await wait();
  check('native geometry predicate initially excludes node',c.nodes.get('b').nodeEl.classList.contains('mkls-view-hidden'));
  c.nodes.get('b').moveTo({x:threshold+30,y:data('b').y});await wait();check('native move invalidates retained filter index',!c.nodes.get('b').nodeEl.classList.contains('mkls-view-hidden'));
  ext.setView(c,'accepted');await wait();
  app.workspace.setActiveLeaf(c.view.leaf,{focus:true});cmd('edit-property-view');await wait();
  c.metadata.propertyGraph={...c.metadata.propertyGraph,concurrent:'kept'};
  [...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Save view').click();await wait();
  check('stale view editor refuses concurrent metadata overwrite',c.metadata.propertyGraph.concurrent==='kept'&&!!document.querySelector('.mkls-filter-editor'));close();
  c.view.requestSave();await wait(600);
  const countBefore=ext.states.size;const second=app.workspace.getLeaf('window');
  try{
    await second.openFile(c.view.file);await wait(600);const other=second.view.canvas;
    check('separate window starts in All independently',!!ext.states.get(other)&&!ext.states.get(other).active&&ext.states.get(c).active==='accepted');
    ext.setView(other,'geometry');await wait();check('separate window view selection remains independent',ext.states.get(other).active==='geometry'&&ext.states.get(c).active==='accepted');
    second.detach();await wait(300);check('window detach releases property state and hooks',ext.states.size===countBefore&&!ext.states.has(other));
  }finally{if(second.parent)second.detach();app.workspace.setActiveLeaf(c.view.leaf,{focus:true})}
  ext.setView(c);await wait();
  return {checks,passed:checks.length,version:p.manifest.version,fixture,graph:c.getData()};
}
spawnSync('obsidian',[`vault=${basename(vault)}`,'open',`path=${fixture}`],{encoding:'utf8'});
const code=`(${run.toString()})(${JSON.stringify({vault,fixture})}).then(report=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(report))).catch(error=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(error.stack||error),checks:globalThis.__mklsExtendedChecks})))`;
const result=spawnSync('obsidian',[`vault=${basename(vault)}`,'eval',`code=${code}`],{encoding:'utf8',maxBuffer:16*1024*1024});
writeFileSync(output+'.log',result.stdout+result.stderr);
for(let i=0;i<400&&!existsSync(output);i++)await new Promise(r=>setTimeout(r,100));
if(!existsSync(output))throw Error('Native QA timed out: '+output+'.log');
const report=JSON.parse(readFileSync(output,'utf8'));writeFileSync(output,JSON.stringify(report,null,2));
if(report.error){console.error(JSON.stringify(report,null,2));process.exitCode=1}
console.log(JSON.stringify({passed:report.passed,report:output}));
