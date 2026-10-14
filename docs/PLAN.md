# Advanced Canvas property graph fork implementation plan

Status: Development build 7.1.0-mkls.3 adds the persistent canvas menu and advisory relationship rules/creation. Type/lint/build checks pass. Native visual inspection is pending because the running Obsidian CLI socket pathname is absent; the shared app was not restarted. The own-fork draft PR remains open; mkls.1 performance evidence is retained, with no new stress runs.

Updated: 2026-10-14.

Maintainer: Codex, the main MKLS agent. Claude owns the property/menu UI and supports research through the existing Herdr `mkls` session. This plan is authored by an LLM agent and will be updated as tasks, decisions and evidence change.

Build our own maintained fork of Advanced Canvas with properties on every node and edge, YAML frontmatter available during editing and hidden in rendered content, and persistent views that filter the displayed graph by those properties. Investigate and measure the work needed for large canvases. Reuse the property and filter foundations for later querying and bulk updates.

The user authorized implementation alongside Claude on 2026-10-12, property UI improvements on 2026-10-13, and the persistent menu/relationship UI on 2026-10-14. No Impeccable use. New stress tests remain excluded at the user’s request.

## Current baseline

| Item | Observed state |
| --- | --- |
| Upstream | [Developer-Mike/obsidian-advanced-canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas) |
| Local research checkout | `Advanced_Canvas/` |
| Pinned commit | `4b8630c641bec6f6329adb8436a4d35752280d74` |
| Upstream / fork version | 7.1.0 / 7.1.0-mkls.3 |
| Minimum Obsidian version | 1.14.4 (tested floor) |
| Implementation | TypeScript, esbuild, existing Canvas extensions and runtime patches |
| Existing properties | Canvas-level `metadata.frontmatter`; text-node Markdown metadata is also indexed |
| Requested addition | A uniform editable property model for text, file, link and group nodes, plus edges |
| Current MKLS library | READY r415, 215,411 nodes and 343,175 edges; semantic enrichment remains incomplete |

Upstream's [contribution policy](https://github.com/Developer-Mike/obsidian-advanced-canvas/blob/main/CONTRIBUTING.md) declines LLM code contributions. Develop and release through our own fork, preserve its license and attribution, and mark agent-produced changes as required by upstream `AGENTS.md`. The implementation lives in `vlermandac/mkls-advanced-canvas` on branch `mkls-property-graph`, with independent plugin ID `mkls-advanced-canvas`. Upstream push is disabled.

## Functional contract

### Properties and frontmatter

- Every native node type and every edge can have its own property map. Native element IDs, directed endpoints, parallel edges, geometry, content and styles retain their existing meanings.
- YAML frontmatter is visible when editing the element. Clicking away renders the node body or edge label with the frontmatter hidden. Editing again exposes the saved properties.
- A file node's canvas properties belong to that node instance. Editing them does not modify the linked note's frontmatter. Two nodes referencing one file can have different properties.
- Linked-note properties may later be exposed in a separate read-only namespace. They never substitute for node-instance properties.
- Support strings, finite numbers, booleans, null, lists and nested maps, with explicit filter semantics. Preserve missing versus null, false, zero and empty values. Date comparisons use declared ISO values rather than accidental YAML type coercion.
- Preserve property keys and values without confusing them with native Canvas fields. For example, a graph `type` or `labels` property must not replace the native node `type`.
- Preserve raw YAML, including comments and key order where supported by the parser. Malformed YAML remains recoverable, produces a located error, and cannot silently erase committed properties.
- Existing leading YAML in text nodes stays content until an explicit undoable adoption into element properties. Use one canonical property representation for all element types; editing source can synthesize a YAML prelude without introducing a second authority.
- For the first release, wikilinks inside property values are opaque strings. They participate in property filters and retain their bytes; body/file links retain native handling. Property values do not automatically create backlinks or rewrite on note rename. Indexed property links are a separate future extension with an explicit rename policy.
- Save, reopen, undo, redo, copy, paste, duplicate and export preserve properties. Compatibility checks cover multiline edge labels, mathematical Markdown and existing leading YAML in text nodes.

Example editing source for a node:

```yaml
---
kind: theorem
topic: linear-algebra
status: provisional
reviewed: false
---
Rank–nullity
```

Example editing source for an edge:

```yaml
---
relation: uses
role: assumption
weight: 1
---
uses
```

The node displays `Rank–nullity` and the edge displays `uses` after editing ends. The properties remain available to filters such as node `topic equals linear-algebra` and edge `role equals assumption`. These examples specify editing behavior; the persistent representation is selected in F1.8.

### Views

- A canvas has an unfiltered All view and named saved views. Creating, renaming, duplicating, switching and removing a view affects its configuration and presentation.
- Each view can filter node properties, edge properties, native node type, relation labels and selected built-in fields. Conditions support All, Any and None groups.
- Separate field scopes in the predicate contract: node-instance properties, edge-instance properties and native fields. An optional linked-note scope is read-only and reacts to note metadata changes, rename and deletion independently of canvas revisions.
- The predicate format is structured data and evaluates through explicit operators; it does not require executing arbitrary JavaScript from a canvas.
- Initial operators: exists, missing, equals, not equals, list contains, text contains and ordered numeric/date comparisons. Operator availability follows the value type. Define nested property paths and literal keys unambiguously.
- A node-oriented view shows matching nodes, including isolated matches; an edge is displayed only when it matches the edge filter and both endpoints are displayed.
- An edge-oriented view shows matching edges and their required endpoints. Any additional node filter is a hard constraint. Endpoint inclusion must never quietly override an explicit node predicate.
- Switching views preserves positions, properties and graph records. Saving under a filter must save the complete graph. Hidden elements remain recoverable through All and cannot be mistaken for deleted elements.
- Selection, hit testing, fit-to-view, search, copy/export and undo have defined behavior under a filter. The first implementation uses visible elements for selection and fit-to-view; full versus current-view export is explicit.
- Link/backlink navigation uses stable element IDs. A link to a hidden element can reveal that element temporarily or switch to All, with the behavior stated explicitly. Reordering/filtering must never select a different element by array offset.
- Moving a group preserves the relative positions of all its members, including hidden members. Deleting a node removes its incident edges from the complete graph, including hidden edges, in one undoable operation.
- Store view definitions in the canvas so they travel with it. Active-view selection always remains per-window state outside the canvas file. Switching saved views adds no content history entry or file write.
- Creating or editing a saved definition is one batched, undoable configuration transaction. Verify whether native history covers canvas metadata; provide a bounded configuration undo path if its history is element-only.
- A view changes what is displayed. Changing matching records is a later explicit update operation.

## Proposed technical direction

The compatibility spike selected per-element versioned YAML records and canvas-owned saved definitions. The implementation follows these choices; optional linked-note querying and virtualization remain future work.

1. Extend each node and edge with a namespaced property record. A candidate representation is `propertyGraph: { yaml: "..." }`, with the YAML bytes as the single persistent source for user properties and parsed typed maps as disposable caches. Keep native `text` and `label` as content; source editing exposes a YAML prelude. If native fields fail persistence, evaluate one canvas-owned ID-keyed property map for all element types. Choose a single representation in F1.8; do not split text nodes and other elements into independent formats.
2. Store schema and saved views under a separate `metadata.propertyGraph` namespace. Keep upstream's format version and existing canvas-level frontmatter intact; version our extension independently.
3. Use one property service, one pure predicate engine and one graph visibility controller. Views and later query/update commands share the same predicate representation and property access rules.
4. Use cached parsing and indexes keyed by element ID and content revision. Recompute affected predicates on property changes; pan/zoom must not parse YAML or reevaluate the whole graph. Own properties are indexed for plugin views/queries. Native global property search exposure is a separate contract decision. If a linked-note query scope is included, invalidate it from Obsidian metadata-change/rename/delete events.
5. Start with a visibility layer over the complete native model. Treat virtualization as a separate measured improvement. If native objects must be removed from the rendered projection, first establish a complete-model adapter covering serialization, edits, deletions, history and collapsed/portal data.
6. Keep generated MKLS canvases separate from the authoritative CSV graph. Any future import records actual KG IDs and revision provenance. A canvas edit cannot implicitly reconcile or rewrite the ingestion graph.

The critical first decision is native round-trip behavior: custom fields and full hidden graph data must survive Obsidian's actual save/history/copy paths. This is a go/no-go test before feature coding expands.

## Steps and tasks

Task IDs remain stable. Check a task only after its evidence exists. Codex updates this plan; Claude reports findings and later receives explicitly bounded implementation ownership.

### Phase 0 Project orientation and research

Owner: Codex and Claude. Status: Complete for the initial plan.

- [x] R0.1 Read the MKLS architecture, current source/learner state and preservation rules.
- [x] R0.2 Verify upstream contribution policy, license, current version and exact commit.
- [x] R0.3 Clone an unchanged local baseline for source inspection.
- [x] R0.4 Inspect existing canvas metadata, node/edge editing, serialization, undo and collapse hooks.
- [x] R0.5 Give Claude the project summary, requested scope and provisional phase sequence.
- [x] R0.6 Integrate Claude's performance and native integration findings into the research record.
- [x] R0.7 Finalize this first plan revision with concrete dependencies and acceptance checks; incorporate Claude's plan review.

Exit: a shared, reviewed task plan and source-backed research findings; remaining uncertainties have explicit investigation tasks.

### Phase 1 Own fork and compatibility spike

Owner: Codex. Depends on Phase 0.

- [x] F1.1 Fork created at `vlermandac/mkls-advanced-canvas`; own origin and disabled upstream push configured on `mkls-property-graph`.
- [x] F1.2 Distinct `mkls-advanced-canvas` plugin ID, attribution and conflicting-upstream guard implemented.
- [x] F1.3 Locked npm build and type check pass; native QA uses Obsidian 1.14.4 on Wayland.
- [x] F1.4 In an isolated test vault, verify unknown/namespaced node, edge and canvas fields through actual save/reopen, undo/redo, copy/paste and export. Repeat edit/save round trips with the fork disabled and with vanilla Obsidian/upstream Advanced Canvas; record property/view retention or exact compatibility loss. Probe metadata coverage in history.
- [x] F1.5 Probe text-node editing and edge `labelElement` editing, including focus/blur and multiline YAML. Verify how every native node type exposes its own properties.
- [x] F1.6 Probe current native viewport culling, breakpoints, DOM/SVG object counts and extension hook order. Record which APIs are private and guard their use.
- [x] F1.7 Resolve how properties and views survive collapsed groups, portals and ID remapping. Decide how foreign portal elements can be inspected or edited.
- [x] F1.8 Write the versioned storage contract, explicit legacy-YAML adoption and migration rules from measured results. Record property index/search scope, opaque wikilink semantics and external-editor compatibility.
- [ ] F1.9 Specify a batched edit transaction, per-element patch disposal and stable-ID navigation before implementing properties/views. Start B4.1/B4.2 baseline instrumentation here; verify retention with heap evidence rather than assuming a leak size.

Exit: the chosen representation passes native persistence checks; editing and visibility hooks are known; the fork builds under its own identity.

### Phase 2 Node and edge properties

Owner: Codex, with a bounded Claude implementation task after F1.8. Depends on Phase 1.

- [x] P2.0 Implement and verify the foundational transaction/disposal/navigation fixes from F1.9 before property editing or filtered-model changes. Remove unused full snapshots and batch save/history work while preserving native outcomes.
- [x] P2.1 Shared raw-YAML property service, strict typed values, revision cache and located diagnostics implemented and tested.
- [x] P2.2 Implement source editing for text nodes with frontmatter visible in editing and omitted from the rendered body.
- [x] P2.3 Implement multiline edge editing with the same property behavior; rendered labels show the body only.
- [x] P2.4 Add instance-specific property editing for file, link and group nodes; keep linked files unchanged.
- [x] P2.5 Integrate a property change with native save and one logical undo action. Preserve unfinished/invalid edits through the documented recovery path.
- [ ] P2.6 Preserve properties across copy, paste, duplication, templates, exports, collapsed groups and applicable portal paths. Verify explicit legacy-YAML adoption/undo and opaque wikilink-value round trips.
- [x] P2.7 Publish property-change events for the view engine; keep rendering events distinct from actual data changes.
- [x] P2.8 Add meaningful parser/persistence regression tests and native edit/blur/reopen checks.

Exit: every supported element retains properties after reopening; editing exposes frontmatter and unfocused rendering hides it; undo restores both content and properties.

### Phase 3 Filter engine and saved views

Owner: Codex for integration; Claude may own the pure filter/index module. Depends on F1.8 and P2.1.

- [x] V3.1 Claude implemented typed predicates with nested groups, safe lookup and explicit missing/null semantics; 61 focused filter tests pass.
- [x] V3.2 Endpoint policies, isolated nodes, parallel edges and self-loops covered by reference/incremental equivalence tests.
- [x] V3.3 Persist named view definitions and validate configuration versions. All always restores the complete canvas. Batch definition edits into one undoable configuration transaction; keep active-view switching exclusively in per-window state.
- [x] V3.4 Add the minimum functional controls to create, edit and switch views; visual design remains deferred.
- [x] V3.5 Apply visibility incrementally; prevent invisible elements from receiving pointer selection or interfering with visible bounds.
- [x] V3.6 Ensure every save/history operation retains hidden records and metadata. Reapply the active predicate after undo/redo without creating a filter-induced content edit.
- [x] V3.7 Define explicit full/current-view copy and export behavior and validate endpoint integrity.
- [ ] V3.8 Cover zero matches, malformed property data, deleted fields, changed types, duplicate view names, two windows, reopening and file reloads. Test races with existing canvas Properties/file-manager writers and unsaved open-view edits; use revision guards and coordinated writes to preserve namespaced data. If included, test linked-note cache invalidation on metadata change/rename/delete.
- [x] V3.9 Verify stable-ID navigation to hidden elements, hidden-member group moves, visible-node deletion with hidden incident edges, and read-only portal projection behavior.

Exit: matching node/edge views work after reopening; a filtered edit/save/undo round trip preserves all hidden elements exactly apart from the requested edits.

### Phase 4 Large graph measurements and optimization

Owner: Claude for benchmark/optimization work; Codex for integration and data-preservation review. Instrumentation starts in Phase 1; final measurements depend on Phase 3.

- [ ] B4.1 Establish the same deterministic fixtures for native Canvas, upstream 7.1.0 and our fork. Include sparse, dense, grouped and media-containing graphs; vary both nodes and edges.
- [ ] B4.2 Measure cold/warm open, pan/zoom frame time, node drag, property edits, filter changes, save/history latency, DOM/SVG count and memory. Record actual hardware, app/plugin versions and settings.
- [ ] B4.3 Inspect and prioritize full-graph serialization, route invalidation, whole-canvas metadata indexing, group membership scans and repeated DOM work using trace evidence.
- [x] B4.4 Optimize incremental property parsing/filter evaluation, adjacent-edge updates, dirty sets, event batching and save/history batching without changing outcomes.
- [ ] B4.5 Optimize routing and groups with indexed lookups, cached geometry and bounded work. Preserve semantic/geometry correctness and invalidate caches precisely.
- [x] B4.6 Evaluate level-of-detail rendering, offscreen content/media mounting and viewport culling. Cache compact labels at distant zoom levels where useful.
- [ ] B4.7 If native rendering remains the limiting cost, build a measured bounded projection/virtualization prototype behind a feature flag and the complete-model adapter. Record the supported ceiling before expanding it.
- [ ] B4.8 Rerun the same fixtures after changes and publish before/after results, regressions and practical size limits.

Suggested benchmark ladder: 100, 1,000, 5,000 and 10,000 nodes with realistic edge ratios; progress to 50,000 only after the prior tier remains usable. Test large full-model filtering independently of how many objects are mounted. Investigate the full MKLS-size graph after lower tiers establish memory and latency behavior; its entire native rendering capacity is an open measurement question.

Benchmark A* routing at 0%, 10% and 100% of edges; measure long tasks and route-budget exhaustion. Include repeated undo/redo and plugin reload cycles to detect retained element objects. Applying/clearing an already-saved view must add no history entry and leave graph/content bytes unchanged; creating/editing the saved definition is a separate intentional write.

Provisional acceptance targets, to ratify after baseline measurement: 10,000 nodes/30,000 edges with mostly plain text, warm opening within 5 seconds, indexed filter changes within 500 ms, local property edits within 100 ms, and p95 pan/zoom frames within 32 ms when the viewport contains at most 500 nodes/2,000 edges. These are engineering targets, not measured capabilities or promises for media-heavy canvases.

Exit: published measurements, completed optimizations supported by traces, no graph-loss regressions, and an explicit tested size/content envelope.

### Phase 5 Integration and release

Owner: Codex, with independent Claude review. Depends on Phases 2–4.

- [x] I5.1 Run TypeScript/build/lint checks and focused property/filter/persistence tests. Add tests for risks and observable behavior rather than reproducing implementation details.
- [x] I5.2 Exercise the native Obsidian workflow in an isolated vault: edit/blur, views, reopen, copy/paste, undo/redo, groups, multiwindow and export.
- [x] I5.3 Check plugin enable/disable/reload and supported Obsidian versions. Verify stored records remain readable and existing canvases remain recoverable when the fork is disabled.
- [x] I5.4 Obtain Claude's independent review of storage preservation, predicate semantics and measured performance claims.
- [x] I5.5 Package development build 7.1.0-mkls.1 with installation, migration, compatibility, benchmark and update documentation.
- [ ] I5.6 Install the selected release into MKLS_Study when that implementation/install action is requested; retain a recoverable prior plugin/config snapshot.

Exit: a reproducible fork release with properties, saved filtered views, regression evidence and stated performance boundaries.

### Phase 6 Later basic queries and updates

Owner: Codex and Claude. Status: Deferred until the first release.

- [ ] Q6.1 Expose the shared predicate engine for querying nodes or edges, with an explicit full-graph/current-view scope and result count.
- [ ] Q6.2 Add a structured bulk action such as `matching nodes -> set color`. Show the exact match count and proposed change before applying it.
- [ ] Q6.3 Apply the operation as one transaction with one undo step and batched persistence. Check the model revision again before committing a previewed result.
- [ ] Q6.4 Extend actions to node/edge-instance property updates and native styles as justified by actual use. Linked-note properties remain read-only; bulk commands cannot write those notes. Preserve provenance and keep MKLS CSV updates a separate future adapter/workflow.

Exit: the example “all nodes with property X, change color to Y” works reproducibly and can be undone as one operation.

## Work allocation and integration order

Codex owns plan updates, fork setup, storage/API decisions and final integration. Claude implemented the pure predicate/index module, metadata cache, selection work, spatial obstacle helper and native benchmark harness with exclusive file ownership. Claude reviewed preservation and performance claims independently. Codex integrated native editing, views, transactions, lifecycle and the routing cache. Claude is idle after completing the final performance report. Avoid concurrent edits to the core patcher, shared types or this plan.

The main dependency chain is F1.8/F1.9 -> P2.0/P2.1 -> V3.1/V3.2 -> V3.5/V3.6 -> integration. Performance instrumentation begins alongside the compatibility spike; optimized virtualization depends on verified full-model preservation. Bulk updates depend on the same property/filter contract and a tested transaction boundary.

## Project boundaries

Keep the source library, ingestion graph, source notes, learner submissions and Engram scheduling unchanged during this plugin work. Development fixtures and benchmarks use separate retained data. New Linux desktop integration targets Wayland. Existing inert upstream platform material stays untouched unless it concretely blocks the authorized work. Publish and maintain our implementation through our own fork.

## Decision and progress log

| Date | Decision or evidence | Status |
| --- | --- | --- |
| 2026-10-11 | Upstream 7.1.0 at the pinned commit cloned locally for research | Complete |
| 2026-10-11 | Claude completed source/performance research in Herdr session `mkls`, pane `w1:p2`; report retained and important claims checked against source | Complete |
| 2026-10-11 | Early transaction/disposal checks and stable-ID navigation added before property/view implementation | Planned F1.9/P2.0 |
| 2026-10-11 | User deferred UI design and requested no Impeccable use | Applied |
| 2026-10-11 | Complete graph preservation, per-instance file-node properties and shared predicates established as design requirements | Proposed contract |
| 2026-10-11 | Native compatibility spike will choose per-element namespaced YAML or one canvas-owned ID-keyed map, using the same representation for every element | Pending F1.8 |
| 2026-10-11 | Claude's plan review incorporated: one storage model, explicit YAML adoption, field scopes, opaque property links, per-window active views and early external-editor checks | Complete |
| 2026-10-12 | Implementation authorized; fork created and isolated MKLS Canvas QA vault registered using Obsidian's own vault-open handler | Complete |
| 2026-10-12 | Native raw YAML edit/blur, filtered visibility, complete hidden-record save, no-write view switching and saved-view undo/redo | 16 checks passed in `evidence/native-qa-drafts.json` |
| 2026-10-12 | Claude implemented pure filters and bounded metadata/indexing/selection optimizations; native integration review completed | Integrated; further native checks underway |

## Sources and evidence

- [Upstream contribution policy](https://github.com/Developer-Mike/obsidian-advanced-canvas/blob/main/CONTRIBUTING.md).
- [Upstream agent change-provenance instruction](../AGENTS.md).
- [Current native Canvas types](../src/@types/Canvas.d.ts).
- [Current node/edge patcher and persistence hooks](../src/patchers/canvas-patcher.ts).
- [Advanced JSON Canvas property contract](../assets/formats/advanced-json-canvas/spec/1.0-1.0.d.ts).
- [Current metadata indexing](../src/patchers/metadata-cache-patcher.ts).
- [Current collapsed-group projection/expansion](../src/canvas-extensions/collapsible-groups-canvas-extension.ts).
- [Obsidian Bases view/filter behavior](https://obsidian.md/help/bases/views), used as a functional reference; no automatic native Bases compatibility is assumed.
- [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), the baseline node/edge format.
- [Performance research](RESEARCH.md), updated as source inspection and later measurements produce evidence.
- [Claude source report](CLAUDE_SOURCE_REVIEW.txt), preserved from the existing agent's terminal; some references in the original report used cumulative line numbers, so the research summary uses verified per-file locations.

## Development build checkpoint (2026-10-12)

Implemented: raw YAML on every native element type, edit/blur/source modal, recovery drafts, explicit adoption, saved views with typed predicates, definition undo/redo, duplicate/export, stable-ID navigation, hidden group movement/deletion, read-only portal contents following their local host, and separate window state. The native body editor remains usable; its YAML panel is anchored above it.

Final evidence: `artifact-basic.json` (20 checks), `artifact-extended.json` (48), `artifact-races.json` (11), `artifact-lifecycle.json` (10): all 89 pass. `compatibility-first.json` adds eight vanilla/upstream preservation checks. `tests-final-artifact.txt` reports 93 passing unit regressions. A clean locked install, TypeScript, lint and production build pass. All 87 retained canvases pass `artifact-json-canvas-validation.json`. Reports are retained in `evidence/` and selected small reports are copied into the fork documentation.

Scope of checked tasks: native copy serialization/ID remapping was exercised through getSelectionData/cloneData/importData, rather than overwriting the user's desktop clipboard. Supported app floor is now Obsidian 1.14.4, the tested version. Vanilla and unchanged upstream preserved the extension fields; only the fork implements their behavior. Disable/reload restores flat canonical model and history before hooks are removed. Obsidian 1.14.4 serializes its cached canvas data root; that cache is synchronized at actual serialization, transaction commit and unload. Native checks assert edited YAML on disk and complete records after vanilla saving with the fork disabled.

The performance report is PERFORMANCE.md. Sparse 10k/30k, grouped about 1k, dense 1k and local media100 were measured; only sparse was compared across all three modes at 10k. Overview simplification is optional and improves one measured 1k case, but broad large overviews remain slow. A* obstacle lookup and pan route caching were added. The upstream 1k/10% run exceeded the driver timeout and was interrupted, without enough phase evidence to attribute the delay. A cached fork run stalled before opening its fixture while QA was on another workspace; both are invalid timing evidence. A later visible cached fork 1k/10% run completed successfully.

Remaining exploratory work is intentionally visible: template-specific native checks (P2.6), a profiler/forced-GC retention study (F1.9), the complete external Properties/file-manager race matrix (V3.8), all-mode dense/media benchmarking and cold app start/drag/save latency (B4.1/B4.2), routing area/group optimization and renderer/projection prototyping (B4.3/B4.5/B4.7). These do not justify claiming a full 215k-node MKLS canvas is supported. Queries and bulk updates remain Phase6. No learner vault installation has been requested.

Final routing reports `astar-fork-final-100` and `astar-fork-final-1000-10` completed without failures, warnings or route timeouts. They measure 100 nodes/300 A* edges and 1,000 nodes/3,000 edges with 10% A*, respectively. Larger routing workloads remain unmeasured.

Development package: `evidence/releases/final-7.1.0-mkls.1/mkls-advanced-canvas-7.1.0-mkls.1.zip`, with SHA256SUMS. The package contents match the tested production bundle.

Delivered: commit `d630418` on `mkls-property-graph`; [own-fork draft PR #1](https://github.com/vlermandac/mkls-advanced-canvas/pull/1). Implementation checkout is clean. No merge, release publication or study-vault install was performed.

## Active follow-up: schemas and property editing (2026-10-13)

User assigned edge typography and custom canvas node/edge schemas to Codex, and property UX/UI analysis and improvements to the existing Claude agent. The supplied screenshot shows the native toolbar overlapping the in-node YAML panel. No Impeccable use. The user requested no further stress tests.

- [x] S7.1 Delegate and agree exclusive ownership, storage/API and no-schema/schema editing rules with Claude.
- [x] S7.2 Match native edge labels to Obsidian node-body text font/size and zoom behavior.
- [x] S7.3 Implement separate versioned node/edge schema definitions: literal field names, text/number/boolean/date/list/object, required/nullable/default/options, and explicit allowAdditional policy.
- [x] S7.4 Add a guided schema editor/removal and selected-element defaults command with one undo action and revision guards. Schema changes do not rewrite existing values.
- [x] S7.5 Preserve raw YAML/comments when applying missing defaults; preserve false/zero/null/missing distinctions, unknown fields and unsupported schemas.
- [x] S7.6 Claude: replace toolbar-interfering inline panels with a bounded screen-space property editor; typed fields/free creation without schema, predefined fields/default suggestions with schema, raw YAML mode and keyboard access.
- [x] S7.7 Keep syntactically valid schema-invalid drafts editable as fields so required properties can be completed one by one. Preserve committed values for views and recovery/revision guards.
- [x] S7.8 Complete type/lint/build checks, native visual UX inspection in QA, documentation, development package and own-fork draft PR update. No stress tests or benchmark reruns; earlier reports stay qualified to mkls.1.

Shared contract/ownership: [schema and UI brief](SCHEMA_UI_BRIEF.md). UX findings: [Claude's analysis](PROPERTY_UX.md). Queries/bulk updates remain deferred.

Follow-up inspection: node and edge font settings match at16px in QA; the property dock stays outside canvas transforms and the toolbar moves beside it. A clean vault-scoped renderer reload removed stale listeners from an older plugin instance (cause unproven). Teardown now always invokes base cleanup even if editor flush fails. Visual scope and uninspected cases are stated in the UX report.

Current package: `evidence/releases/final-7.1.0-mkls.2/mkls-advanced-canvas-7.1.0-mkls.2.zip`, with SHA256SUMS. Installed QA files and packaged production files match. [Schema guide](../docs/PROPERTY_GRAPH.md) and [two-node example](../examples/property-schema.canvas) document the new workflow.

Follow-up committed and pushed: `da55f2d`; [draft PR#1](https://github.com/vlermandac/mkls-advanced-canvas/pull/1) updated. The living project plan and repository implementation/documentation are delivered; subsequent review or feature requests can extend the remaining roadmap.

## Active follow-up: persistent menu and relationship guidance (2026-10-14)

User assigned the UI to Claude and rules/creation to Codex. A persistent floating top-left menu contains schema, saved-view actions, relationship rules and the selected element properties. Rules are advisory, with natural endpoint-type patterns and an edge-type chooser during new connection creation; no enforcement of existing edges or manual property edits.

- [x] R8.1 Agree the UI/core contract and exclusive ownership with Claude; preserve no-Impeccable/no-stress preferences.
- [x] R8.2 Store versioned directed endpoint rules and configurable graph type property keys; match strings or string-list node types and union matching relation choices.
- [x] R8.3 Add guarded undoable rule editing/removal, preserving schemas/views and unknown fields. Unsupported rule versions stay read-only.
- [x] R8.4 Intercept native new-edge completion before saving/history. Provisional connections stay visible in filtered views but are excluded from canonical serialization/indexes until complete.
- [x] R8.5 Offer choices for matching source/target types; selecting one creates the typed/labeled edge in one transaction, with schema defaults and editable drafts for missing required fields. Cancellation leaves no graph record; no-match/untyped/reconnect/blank-space paths retain native creation behavior.
- [x] R8.6 Claude: persistent menu, view actions, natural rules modal and contextual relationship chooser, focus/cancel behavior and responsive layout.
- [x] R8.7 Compile/lint/build, docs/example/package and own-fork draft PR update. No stress tests, benchmark or regression suites rerun.
- [ ] R8.8 Native visual inspection of menu/rules/chooser after CLI access is restored. QA has the new files, but the running window still uses mkls.2. The absent CLI socket path prevents access; restarting the shared main process would also affect another open vault, so no restart was performed.

Rules use committed per-element properties, separate from native JSON Canvas node types. Direction matters; reverse direction requires its own rule. This version models endpoint type patterns, not arbitrary executable logic or type-inheritance reasoning. Coordinate via [relation/menu brief](RELATION_MENU_BRIEF.md); UX notes in RELATION_MENU_UX.md.

Development package: `evidence/releases/final-7.1.0-mkls.3/mkls-advanced-canvas-7.1.0-mkls.3.zip`, SHA-256 `cb3f3d43a30bf437082d62f2f3addd4c3845f12b8cbc00c015cbc2e4965f421e`. Packaged files match dist and the copied QA files. Native visual inspection remains R8.8; the running QA window has not loaded this build. Current usage and storage: [guide](../docs/PROPERTY_GRAPH.md); [example](../examples/relationship-guidance.canvas). Implementation continues on our own branch and [draft PR #1](https://github.com/vlermandac/mkls-advanced-canvas/pull/1).
