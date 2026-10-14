// Authored by Codex (LLM agent). Disable/reload and optional overview preserve canonical data.
import {spawnSync} from 'node:child_process';
import {resolve,basename,join} from 'node:path';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const vault=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3]||!basename(vault).includes('QA')||existsSync(output))throw Error('QA vault and new report required');
const fixture='Lifecycle-'+Date.now()+'.canvas';
writeFileSync(join(vault,fixture),JSON.stringify({metadata:{version:'1.0-1.0',frontmatter:{},propertyGraph:{version:1,views:[{id:'v',name:'View',mode:'nodes'}]}},nodes:[{id:'g',type:'group',label:'Group',collapsed:true,x:0,y:0,width:700,height:400},{id:'a',type:'text',text:'Inside',x:30,y:50,width:200,height:100,propertyGraph:{version:1,yaml:'# preserved\nstatus: accepted\n'}},{id:'b',type:'text',text:'Other',x:350,y:50,width:200,height:100}],edges:[{id:'ab',fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',label:'Uses',propertyGraph:{version:1,yaml:'kind: reference\n'}}]}));
async function run({vault,fixture}){
 if(app.vault.adapter.getBasePath()!==vault)throw Error('Wrong vault');let p=app.plugins.getPlugin('mkls-advanced-canvas'),c;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<100;i++){c=p.getCurrentCanvas();if(c?.view.file?.path===fixture)break;await wait(50)}
 if(c?.view.file?.path!==fixture)throw Error('Wrong fixture');const checks=[];globalThis.__lifecycleChecks=checks;
 const check=(name,ok,details)=>{checks.push({name,passed:!!ok,details});if(!ok)throw Error(name)};
 check('collapsed runtime keeps full canonical records',c.nodes.size===1&&c.getData().nodes.length===3&&c.getData().edges.length===1);
 const before=JSON.parse(JSON.stringify(c.getData())),history=c.history.data.length;
 await app.plugins.disablePlugin('mkls-advanced-canvas');await wait(200);
 check('disable restores complete native model',c.nodes.size===3&&c.edges.size===1,c.getData());
 check('disable preserves YAML and view definitions',c.nodes.get('a').getData().propertyGraph.yaml===before.nodes.find(n=>n.id==='a').propertyGraph.yaml&&JSON.stringify(c.getData().metadata.propertyGraph)===JSON.stringify(before.metadata.propertyGraph));
 check('disable projection cleanup adds no content history',c.history.data.length===history);
 c.undo();await wait(50);c.redo();await wait(50);check('vanilla history retains collapsed member records',c.getData().nodes.length===3);
 await c.view.save();await wait(200);const disk=JSON.parse(await app.vault.read(c.view.file));
 check('vanilla save after disable keeps flat canonical members',disk.nodes.length===3&&disk.edges.length===1&&disk.nodes.find(n=>n.id==='a').propertyGraph.yaml.includes('# preserved'),disk);
 await app.plugins.enablePlugin('mkls-advanced-canvas');await wait(300);p=app.plugins.getPlugin('mkls-advanced-canvas');c=p.getCurrentCanvas();
 check('reload restores property extension and collapsed projection',!!p&&c.nodes.size===1&&c.getData().nodes.length===3);
 const group=c.nodes.get('g');c.selectOnly(group);app.commands.executeCommandById('mkls-advanced-canvas:toggle-collapse-group');await wait(200);
 c.view.requestSave();await wait(700);
 const source=JSON.stringify(c.getData()),h=c.history.data.length,old=p.settings.getSetting('lightweightOverviewEnabled');
 await p.settings.setSetting({lightweightOverviewEnabled:true});await wait(50);
 c.wrapperEl.addClass('mod-zoomed-out');const edge=c.edges.get('ab'),path=edge.lineGroupEl.querySelector('path.canvas-interaction-path');
 check('overview option hides edge hit areas while zoomed out',c.wrapperEl.dataset.lightweightOverviewEnabled==='true'&&getComputedStyle(path).display==='none');
 c.wrapperEl.removeClass('mod-zoomed-out');check('zoom-in restores edge hit areas',getComputedStyle(path).display!=='none');
 await p.settings.setSetting({lightweightOverviewEnabled:old});
 check('overview option does not change graph or history',JSON.stringify(c.getData())===source&&c.history.data.length===h,{before:JSON.parse(source),after:c.getData(),historyBefore:h,historyAfter:c.history.data.length});
 return {checks,passed:checks.length,fixture};
}
spawnSync('obsidian',[`vault=${basename(vault)}`,'open',`path=${fixture}`],{encoding:'utf8'});
const code=`(${run.toString()})(${JSON.stringify({vault,fixture})}).then(r=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(r))).catch(e=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(e.stack||e),checks:globalThis.__lifecycleChecks})))`;
const result=spawnSync('obsidian',[`vault=${basename(vault)}`,'eval',`code=${code}`],{encoding:'utf8',maxBuffer:16*1024*1024});writeFileSync(output+'.log',result.stdout+result.stderr);
for(let i=0;i<400&&!existsSync(output);i++)await new Promise(r=>setTimeout(r,100));
if(!existsSync(output))throw Error('Lifecycle checks timed out');const report=JSON.parse(readFileSync(output,'utf8'));writeFileSync(output,JSON.stringify(report,null,2));if(report.error){console.error(JSON.stringify(report,null,2));process.exitCode=1}console.log(JSON.stringify({passed:report.passed,report:output}));
