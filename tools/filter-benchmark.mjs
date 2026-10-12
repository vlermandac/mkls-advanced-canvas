// Authored by Codex (LLM agent). Reproducible pure-engine benchmark driver.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.bench-build',{recursive:true});
await build({entryPoints:['bench/filter-benchmark.ts'],bundle:true,platform:'node',format:'cjs',outfile:'.bench-build/filter.cjs'});
const result=spawnSync(process.execPath,['.bench-build/filter.cjs'],{stdio:'inherit'});process.exitCode=result.status??1;
