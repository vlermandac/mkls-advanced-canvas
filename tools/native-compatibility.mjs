// Authored by Codex (LLM agent). Unknown-field persistence in vanilla and unchanged upstream.
import {spawnSync} from 'node:child_process';
import {resolve,basename,join} from 'node:path';
import {existsSync,mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
const vault=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3]||!basename(vault).includes('QA')||existsSync(output))throw Error('Isolated QA vault and new report required');
const folder=join(vault,'.obsidian/plugins/advanced-canvas');mkdirSync(folder,{recursive:true});
for(const name of ['manifest.json','main.js','styles.css'])copyFileSync(resolve('../planning/advanced-canvas/evidence/upstream-checkout/dist',name),join(folder,name));
const fixture='Compatibility-'+Date.now()+'.canvas';
const graph={metadata:{version:'1.0-1.0',frontmatter:{},propertyGraph:{version:1,views:[{id:'v',name:'View',mode:'nodes'}]},future:{opaque:true}},nodes:[{id:'one',type:'text',text:'Body',x:0,y:0,width:200,height:100,propertyGraph:{version:1,yaml:'# kept\nx: false\n'},future:{opaque:true}},{id:'two',type:'text',text:'Other body',x:300,y:0,width:200,height:100}],edges:[{id:'edge',fromNode:'one',toNode:'two',fromSide:'right',toSide:'left',label:'Uses',propertyGraph:{version:1,yaml:'weight: 0\n'}}]};
writeFileSync(join(vault,fixture),JSON.stringify(graph,null,2));
async function run({vault,fixture,graph}){
 if(app.vault.adapter.getBasePath()!==vault)throw Error('Wrong vault');
 const fs=require('fs'),checks=[];globalThis.__compatChecks=checks;
 const check=(name,ok,detail)=>{checks.push({name,passed:!!ok,detail});if(!ok)throw Error(name)};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const own=!!app.plugins.getPlugin('mkls-advanced-canvas'),upstream=!!app.plugins.getPlugin('advanced-canvas');
 let leaf;
 try{
  if(own)await app.plugins.disablePlugin('mkls-advanced-canvas');
  if(upstream)await app.plugins.disablePlugin('advanced-canvas');
  await app.plugins.loadManifests();
  for(const mode of ['native','upstream']){
   if(mode==='upstream')await app.plugins.enablePlugin('advanced-canvas');
   await wait(300);leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(fixture));await wait(200);
   const c=leaf.view.canvas;c.nodes.get('one').setData({...c.nodes.get('one').getData(),color:'3'});c.requestSave();await wait(800);
   const disk=JSON.parse(await app.vault.read(leaf.view.file));
   check(mode+' node YAML and unknown fields survive edit/save',disk.nodes.find(n=>n.id==='one').propertyGraph.yaml===graph.nodes[0].propertyGraph.yaml&&disk.nodes.find(n=>n.id==='one').future.opaque);
   check(mode+' edge YAML survives',disk.edges[0].propertyGraph.yaml===graph.edges[0].propertyGraph.yaml);
   check(mode+' view configuration survives',JSON.stringify(disk.metadata.propertyGraph)===JSON.stringify(graph.metadata.propertyGraph));
   const clone=c.cloneData(c.getSelectionData(new Set(c.nodes.values())),{x:0,y:400});c.importData(clone,false);await wait(100);
   check(mode+' native copy/paste remaps IDs with YAML',clone.nodes.some(n=>n.id!=='one'&&n.propertyGraph?.yaml===graph.nodes[0].propertyGraph.yaml)&&clone.edges[0].propertyGraph?.yaml===graph.edges[0].propertyGraph.yaml);
   leaf.detach();leaf=null;await wait(200);
   if(mode==='upstream')await app.plugins.disablePlugin('advanced-canvas');
   await app.vault.modify(app.vault.getAbstractFileByPath(fixture),JSON.stringify(graph,null,2));await wait(200);
  }
 }finally{
  leaf?.detach();if(app.plugins.getPlugin('advanced-canvas'))await app.plugins.disablePlugin('advanced-canvas');
  if(upstream)await app.plugins.enablePlugin('advanced-canvas');if(own)await app.plugins.enablePlugin('mkls-advanced-canvas');
 }
 return {checks,passed:checks.length,fixture};
}
const code=`(${run.toString()})(${JSON.stringify({vault,fixture,graph})}).then(r=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(r))).catch(e=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(e.stack||e),checks:globalThis.__compatChecks})))`;
const result=spawnSync('obsidian',[`vault=${basename(vault)}`,'eval',`code=${code}`],{encoding:'utf8',maxBuffer:16*1024*1024});writeFileSync(output+'.log',result.stdout+result.stderr);
for(let i=0;i<300&&!existsSync(output);i++)await new Promise(r=>setTimeout(r,100));
if(!existsSync(output))throw Error('Native compatibility timed out');
const report=JSON.parse(readFileSync(output,'utf8'));writeFileSync(output,JSON.stringify(report,null,2));
if(report.error){console.error(JSON.stringify(report,null,2));process.exitCode=1}
console.log(JSON.stringify({passed:report.passed,report:output}));
