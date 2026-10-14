# Development build 7.1.0-mkls.3

Authored by Codex and Claude (LLM agents), 2026-10-14. Based on upstream 7.1.0 at the commit in FORK.md. GPL-3.0 license and attribution retained.

## Included

- Per-instance YAML on text, file, link and group nodes and on edges; editing/source/recovery support, with YAML hidden in rendered content.
- Canvas-local node/edge schemas with field types, required/nullable rules, defaults/options and additional-field policy; guided schema editor and explicit default actions.
- Persistent floating menu containing Views, Schema, Rules and selected-element Properties, with a bottom-sheet layout in narrow canvases; toolbar collision handling and schema-invalid drafts remain editable.
- Directed relationship guidance with configurable node/edge type properties and natural rule editing. Matching new connections offer relation choices, create a labeled/property-bearing edge in one transaction and apply edge schema defaults. Guidance remains advisory; untyped connections and existing edges remain available.
- Provisional connection records are excluded from serialization/indexes, including during native blank-space creation, while remaining visible under filters. Cancelling a chooser removes the candidate.
- Edge labels use the node-body font and text size.
- Saved typed graph views, node/edge endpoint rules, All, duplicate/delete/edit/export, and independent window selections.
- Complete canonical persistence and history, stable IDs, revision guards, explicit adoption, and disable/reload normalization.
- Bounded metadata parsing/cache, incremental filters and selection updates, batched history/save work, spatial A* obstacle lookup, and routing cache.
- Optional overview simplification, off by default. It hides arrowheads and edge interactions while zoomed out; zoom-in restores them.

## Install or update

Obsidian 1.14.4 is the tested minimum. Disable upstream Advanced Canvas, retain your current canvases/plugin configuration, and extract the package's `main.js`, `styles.css`, `manifest.json` into `.obsidian/plugins/mkls-advanced-canvas/`. Enable MKLS Advanced Canvas. The fork has independent settings. Replacing these three files and reloading updates the fork; recovery drafts stay in its `drafts/` directory.

Existing canvases require no bulk migration. Adoption of leading text-node YAML is explicit. Unsupported schema versions are preserved and refused for writes. See PROPERTY_GRAPH.md for storage and editing details.

## Verification and limits

TypeScript, lint and production build passed for mkls.3. No new tests, stress tests, benchmark reruns or regression suite runs were performed for this follow-up. Earlier mkls.1 native/regression and benchmark reports remain in `docs/evidence/`; their inline-editor selectors and counts describe that version. The mkls.2 property UX inspection is historical.

Native visual inspection of the new menu/rules/chooser is pending. The existing Obsidian main process has a listening CLI socket whose pathname was removed, so the CLI cannot connect, and no remote debugging port is available. Restarting the main process would also affect another open vault; it was left running. The assembled production files and new demo are copied into the isolated MKLS Canvas QA vault; its existing window has not loaded the new build. After an ordinary app restart, open `Demos/Relationship guidance.canvas` there and inspect the workflow described in RELATION_MENU_UX.md. Build evidence distinguishes copied files from the running window.

The larger generated fixtures remain in the isolated project QA vault. PERFORMANCE.md states measured hardware, sizes, contents and validity constraints. Those measurements were not repeated for mkls.3.

The largest measured plain sparse model is 10,000 nodes / 30,000 edges. Broad overview rendering remains slow. Dense, grouped, media and A* have smaller separately measured envelopes. A complete 215k-node MKLS graph is unmeasured and unsupported as one native canvas. Use source-backed subgraphs and views. A* retains a bounded search budget; timeout results retry after a cooldown, and collapsed obstacle boxes bypass route caching.

Private Canvas APIs require compatibility checks after Obsidian updates; the new connection hook is based on the Obsidian 1.14.4 implementation and has not yet had a native inspection. Native global Properties/Bases do not index these per-element records. Third-party Canvas writers may discard extension fields. Relationship rules match committed type properties; arbitrary executable logic, type inheritance and type inference by traversing other edges are not implemented. Queries and bulk updates remain a later phase.

The authoritative MKLS graph, source notes, learner state and study vault were not modified. Installation into the study vault and publishing a release remain separate actions.
