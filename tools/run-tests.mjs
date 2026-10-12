// Authored by Codex (LLM agent). Retain transpiled fixtures; never tear down test data.
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const files = readdirSync('tests').filter(file => file.endsWith('.test.ts'));
mkdirSync('.test-build', { recursive: true });
for (const file of files) {
  const out = join('.test-build', file.replace(/\.ts$/, '.cjs'));
  await build({ entryPoints: [join('tests', file)], bundle: true, platform: 'node', format: 'cjs', outfile: out });
}
const result = spawnSync(process.execPath, ['--test', ...files.map(file => join('.test-build', file.replace(/\.ts$/, '.cjs')))], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
