# Development evidence

Compiled by Codex (LLM agent), 2026-10-12, for 7.1.0-mkls.1.

- Final native reports: basic20 + extended48 + races11 + lifecycle10 = 89 passing checks. Compatibility-first adds8 passing checks on vanilla Obsidian1.14.4 and unchanged upstream7.1.0.
- Locked clean install, TypeScript/lint and production build pass. The unit report has93 passing tests. JSON Canvas structure/endpoints validate in87 retained fixtures.
- Benchmark summaries embed case data. PERFORMANCE.md qualifies measured shapes, sizes and builds; excluded stalled/hidden runs are not included here. Fork-ladder frame timings are invalid, retained solely for the qualified non-frame measurements.
- Workspace path prefixes are normalized to `<workspace>` in published copies; metric values are unchanged. Original reports, logs and large generated fixtures remain in the isolated project QA vault/evidence tree and are not shipped here.
- BUILD.json records tested bundle and package hashes. The draft PR supplies source and provenance; no release has been published or installed into the learner vault.

Run check, tests and build separately from the fork checkout when verifying changes:

```bash
npm ci
```

```bash
npm run check
```

```bash
npm test
```

```bash
npm run build
```

Native tools require an explicitly supplied registered QA vault. They generate retained fixtures and report paths, and never target learner/source data. Native script assertions include real native editors, hit targets, model/disk/history persistence, groups, portals, multiwindow state and plugin disable/reload; they do not cover every third-party writer or mobile version.
