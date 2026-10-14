// Authored by Codex (LLM agent). Deferred refreshes cannot overwrite newer graph edits.
import {spawnSync} from 'node:child_process';
import {resolve,basename,join} from 'node:path';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const vault=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3]||!basename(vault).includes('QA')||existsSync(output))throw Error('Isolated QA vault and new report required');
const fixture='Races-'+Date.now()+'.canvas';
writeFileSync(join(vault,fixture),JSON.stringify({metadata:{version:'1.0-1.0',frontmatter:{},propertyGraph:{version:1,views:[]}},nodes:[{id:'a',type:'text',text:'Original body',x:0,y:0,width:200,height:100,propertyGraph:{version:1,yaml:'status: accepted\n'}},{id:'b',type:'text',text:'Other body',x:400,y:0,width:200,height:100}],edges:[{id:'edge',fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',label:'Before'}]}));
async function run({vault,fixture}){
 if(app.vault.adapter.getBasePath()!==vault)throw Error('Wrong vault');
 const p=app.plugins.getPlugin('mkls-advanced-canvas');let c;const wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<100;i++){c=p.getCurrentCanvas();if(c?.view.file?.path===fixture)break;await wait(50)}
 if(c?.view.file?.path!==fixture)throw Error('Wrong fixture');window.electronWindow?.webContents.focus();c.wrapperEl.focus();
 const ext=p.canvasExtensions.find(e=>e.constructor.name==='PropertyGraphCanvasExtension');
 const checks=[];globalThis.__raceChecks=checks;const check=(name,ok,details)=>{checks.push({name,passed:!!ok,details});if(!ok)throw Error(name)};
 const capture=data=>{let callback;const ref=app.workspace.on('advanced-canvas:data-loaded:after',(canvas,_data,setData)=>{if(canvas===c&&!callback)callback=setData});try{c.importData(data,true)}finally{app.workspace.offref(ref)}if(!callback)throw Error('Import callback not captured');return callback};
 let before=JSON.parse(JSON.stringify(c.getData())),deferred=capture(before);
 c.nodes.get('a').setData({...c.nodes.get('a').getData(),text:'Newer body',propertyGraph:{version:1,yaml:'status: accepted\nnewer: true\n'}});
 check('stale refresh rejected after element write',deferred(before)===false&&c.nodes.get('a').getData().text==='Newer body'&&c.nodes.get('a').getData().propertyGraph.yaml.includes('newer: true'));
 before=JSON.parse(JSON.stringify(c.getData()));deferred=capture(before);c.importData({nodes:[],edges:[]},false);
 check('empty additive import keeps pending callback valid',deferred(before)===true);
 before=JSON.parse(JSON.stringify(c.getData()));deferred=capture(before);c.metadata.propertyGraph={version:1,views:[{id:'new',name:'New configuration',mode:'nodes'}]};
 const metadataResult=deferred(before);check('stale refresh rejected after metadata write',metadataResult===false&&c.metadata.propertyGraph.views[0].id==='new',{metadataResult,metadata:c.metadata,serialized:c.getData().metadata});
 before=JSON.parse(JSON.stringify(c.getData()));deferred=capture(before);const newer=JSON.parse(JSON.stringify(before));newer.nodes.find(n=>n.id==='a').text='New import';c.importData(newer,true);
 check('older import cannot replace a newer import',deferred(before)===false&&c.nodes.get('a').getData().text==='New import');
 const writer=JSON.parse(JSON.stringify(c.getData()));writer.metadata.propertyGraph={version:1,views:[{id:'writer',name:'External writer',mode:'nodes'}]};c.setData(writer);await wait(100);
 check('native setData writer rebinds metadata and view controls',c.metadata.propertyGraph.views[0].id==='writer'&&Array.from(c.canvasControlsEl.querySelector('.mkls-view-select').options).some(o=>o.value==='writer'));
 const view={id:'label',name:'Label match',mode:'edges',edges:{kind:'condition',scope:'native',path:['label'],operator:'equals',value:'After'}};
 ext.saveView(c,view);await wait(100);const edge=c.edges.get('edge');check('native label predicate excludes old label',edge.lineGroupEl.classList.contains('mkls-view-hidden'));
 ext.setView(c);c.selectOnly(edge);edge.labelElement.focus();edge.labelElement.textareaEl.textContent='After';edge.labelElement.textareaEl.dispatchEvent(new Event('input',{bubbles:true}));edge.labelElement.blur();await wait(100);ext.setView(c,'label');await wait(100);
 check('native edge label edit updates retained index',edge.getData().label==='After'&&!edge.lineGroupEl.classList.contains('mkls-view-hidden'),edge.getData());
 ext.setView(c);edge.labelElement.focus();await wait(50);let field=edge.labelElement.wrapperEl.querySelector('.mkls-frontmatter-text');
 edge.labelElement.textareaEl.textContent='';edge.labelElement.textareaEl.dispatchEvent(new Event('input',{bubbles:true}));field.focus();await wait(100);
 check('empty-label frontmatter stays focused and connected',field.isConnected&&document.activeElement===field);
 edge.render();await wait(50);check('empty-label render keeps active frontmatter editor',field.isConnected&&document.activeElement===field);
 field.dispatchEvent(new MouseEvent('click',{bubbles:true}));check('YAML click does not refocus native edge body',document.activeElement===field);
 field.value='role: unlabeled\n';field.blur();await wait(100);
 check('unlabeled edge preserves properties and releases label hooks',edge.getData().propertyGraph?.yaml==='role: unlabeled\n'&&!edge.labelElement&&!ext.states.get(c).labelDisposers.has(edge));
 ext.setView(c);return {checks,passed:checks.length,fixture};
}
spawnSync('obsidian',[`vault=${basename(vault)}`,'open',`path=${fixture}`],{encoding:'utf8'});
const code=`(${run.toString()})(${JSON.stringify({vault,fixture})}).then(r=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(r))).catch(e=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(e.stack||e),checks:globalThis.__raceChecks})))`;
const result=spawnSync('obsidian',[`vault=${basename(vault)}`,'eval',`code=${code}`],{encoding:'utf8',maxBuffer:16*1024*1024});writeFileSync(output+'.log',result.stdout+result.stderr);
for(let i=0;i<400&&!existsSync(output);i++)await new Promise(r=>setTimeout(r,100));
if(!existsSync(output))throw Error('Race checks timed out');const report=JSON.parse(readFileSync(output,'utf8'));writeFileSync(output,JSON.stringify(report,null,2));if(report.error){console.error(JSON.stringify(report,null,2));process.exitCode=1}console.log(JSON.stringify({passed:report.passed,report:output}));
