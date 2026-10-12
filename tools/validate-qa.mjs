// Authored by Codex (LLM agent). JSON Canvas 1.0 structure/endpoints in retained fixtures.
import {readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,basename,join} from 'node:path';
const vault=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3]||!basename(vault).includes('QA')||existsSync(output))throw Error('QA vault and new report required');
const files=[];function walk(path){for(const e of readdirSync(path,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const p=join(path,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.canvas'))files.push(p)}}walk(vault);
const checks=[];const types=new Set(['text','file','link','group']),sides=new Set(['left','right','top','bottom']),ends=new Set(['none','arrow']);
for(const file of files){const errors=[];try{const data=JSON.parse(readFileSync(file,'utf8')),ids=new Set(),nodes=new Set();
 for(const n of data.nodes??[]){if(typeof n.id!=='string'||ids.has(n.id))errors.push('duplicate/invalid node ID '+n.id);ids.add(n.id);nodes.add(n.id);if(!types.has(n.type))errors.push('invalid type '+n.type);for(const k of ['x','y','width','height'])if(!Number.isInteger(n[k]))errors.push(n.id+': '+k+' must be integer');const k={text:'text',file:'file',link:'url'}[n.type];if(k&&typeof n[k]!=='string')errors.push(n.id+': missing '+k)}
 for(const e of data.edges??[]){if(typeof e.id!=='string'||ids.has(e.id))errors.push('duplicate/invalid edge ID '+e.id);ids.add(e.id);if(!nodes.has(e.fromNode)||!nodes.has(e.toNode))errors.push('dangling endpoint '+e.id);for(const k of ['fromSide','toSide'])if(e[k]!==undefined&&!sides.has(e[k]))errors.push('invalid '+k);for(const k of ['fromEnd','toEnd'])if(e[k]!==undefined&&!ends.has(e[k]))errors.push('invalid '+k)}
 }catch(e){errors.push(String(e))}checks.push({file:file.slice(vault.length+1),passed:!errors.length,errors})}
const report={standard:'https://jsoncanvas.org/spec/1.0/',checked:checks.length,failed:checks.filter(c=>!c.passed).length,checks};writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({checked:report.checked,failed:report.failed,report:output}));if(report.failed)process.exitCode=1;
