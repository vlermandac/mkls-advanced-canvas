// Authored by Codex (LLM agent). Package locally; no release publishing or vault installation.
import { readFileSync,mkdirSync,copyFileSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
const manifest=JSON.parse(readFileSync('dist/manifest.json','utf8'));
const root=resolve(process.argv[2]??'.release');
const folder=join(root,manifest.id+'-'+manifest.version);mkdirSync(folder,{recursive:true});
for(const name of ['main.js','styles.css','manifest.json'])copyFileSync(join('dist',name),join(folder,name));
for(const name of ['LICENSE','FORK.md'])copyFileSync(name,join(folder,name));
const zip=folder+'.zip';if(existsSync(zip))throw Error('Archive already exists; use a new output directory');
const result=spawnSync('zip',['-q','-r',zip,'.'],{cwd:folder,stdio:'inherit'});
if(result.status!==0)throw Error('Packaging failed');console.log(zip);
