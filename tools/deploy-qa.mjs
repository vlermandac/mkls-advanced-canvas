// Authored by Codex (LLM agent). Deploy only into an explicitly supplied QA vault.
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const vault = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !basename(vault).includes('QA') || !existsSync(join(vault, '.obsidian'))) throw Error('Supply an existing, isolated QA vault');
const folder = join(vault, '.obsidian/plugins/mkls-advanced-canvas'); mkdirSync(folder, { recursive: true });
for (const file of ['main.js', 'styles.css', 'manifest.json']) copyFileSync(join('dist', file), join(folder, file));
mkdirSync('.test-build',{recursive:true});const output=resolve('.test-build/deploy-'+Date.now()+'.json');
const code = `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw Error('Wrong vault');await app.plugins.loadManifests();if(app.plugins.getPlugin('mkls-advanced-canvas'))await app.plugins.disablePlugin('mkls-advanced-canvas');await app.plugins.setEnable(true);await app.plugins.enablePluginAndSave('mkls-advanced-canvas');return {loaded:!!app.plugins.getPlugin('mkls-advanced-canvas'),path:app.vault.adapter.getBasePath()};})().then(r=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(r))).catch(e=>require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(e.stack||e)})))`;
const result = spawnSync('obsidian', [`vault=${basename(vault)}`, 'eval', `code=${code}`], { encoding: 'utf8' });
writeFileSync(output+'.log',result.stdout+result.stderr);
for(let i=0;i<200&&!existsSync(output);i++)await new Promise(r=>setTimeout(r,100));
if(!existsSync(output))throw Error('QA deployment did not finish');
const report=JSON.parse(readFileSync(output,'utf8'));if(!report.loaded)throw Error(JSON.stringify(report));console.log(JSON.stringify(report));
