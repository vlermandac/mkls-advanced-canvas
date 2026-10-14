# Advanced Canvas source research

Authored by Codex, an LLM agent. Updated 2026-10-11. Baseline: upstream 7.1.0, commit `4b8630c641bec6f6329adb8436a4d35752280d74`.

Source inspection identifies work performed by the code. It does not establish measured latency or speedups. Native benchmarks are planned separately.

## Storage and integration observations

- Canvas frontmatter is already stored at `metadata.frontmatter`; current generic node and edge types have no uniform frontmatter field. Text-node content is parsed through Obsidian's Markdown metadata function, which can already recognize leading YAML for text nodes. That does not provide a uniform property editing/render contract for every node type and edge.
- Node editing exposes `advanced-canvas:node-editing-state-changed`. Edges use a separate `labelElement` with `isEditing`, `textareaEl` and `render`. Edge source editing therefore needs its own verified integration hook.
- Every changed node or edge `setData` captures full canvas data and requests save; history also uses complete canvas snapshots. Existing undo/redo forces full reimport. Batching and dirty tracking must preserve these semantics.
- Collapsed groups remove child records from the current rendered representation and restore them during `data-requested`. Views must compose with this existing transformation rather than saving only visible elements.
- The plugin patches private Obsidian runtime methods. Namespaced field preservation and exact hook behavior require actual native tests before choosing the persistent representation.

## Initial performance candidates

| Candidate | Code evidence | Investigation or improvement |
| --- | --- | --- |
| Full graph snapshot work per element edit | `src/patchers/canvas-patcher.ts`, node and edge `setData` patches | Trace `getData` calls and serialization; batch transactions and avoid unchanged work |
| Full reimport for undo/redo | `src/patchers/canvas-patcher.ts`, `undo` and `redo` overrides | Measure restoration; preserve full history while reducing redundant extension work |
| All text nodes reindexed after canvas changes | `src/patchers/metadata-cache-patcher.ts`, `computeCanvasMetadataAsync` | Cache by node ID/content hash and limit concurrent parsing; retain link/position correctness |
| Repeated group containment and incident-edge scans | `src/canvas-extensions/collapsible-groups-canvas-extension.ts`, `collapseNodes` | Indexed membership and endpoint sets, with nested/overlap regression fixtures |
| Routing and per-render edge change events | `src/canvas-extensions/advanced-styles/edge-styles.ts` and `canvas-patcher.ts` | Trace invalidation and route reuse; distinguish rendering from mutation |
| Native content mounting and breakpoints | `src/@types/Canvas.d.ts`, `variable-breakpoint-canvas-extension.ts` | Probe native culling before introducing an additional visibility/virtualization layer |

## Historical evidence

Upstream [issue 137](https://github.com/Developer-Mike/obsidian-advanced-canvas/issues/137) reported severe routing-related lag and was closed with changes in 3.4.0. That history identifies useful regression fixtures; it does not prove the same failure exists in 7.1.0. Reevaluate current code and measure current behavior.

## Claude review

Claude completed an independent read-only review through Herdr. Its [original report](CLAUDE_SOURCE_REVIEW.txt) is retained. Codex checked the important findings directly against the pinned source. Several original report references used cumulative line numbering; the locations below are actual per-file lines.

| Finding | Verified source location | Consequence for the plan |
| --- | --- | --- |
| A full canvas snapshot is captured on an initialized element change even when `addHistory` is false | `src/patchers/canvas-patcher.ts:371` for nodes and `:486` for edges | Remove unused captures and define one transaction/save/history boundary before property or bulk-edit work. A naive update of k elements repeats full-model work k times. |
| Every element patch registers its uninstaller with the plugin, even when the element also has separate uninstall tracking | `src/patchers/patcher.ts:115`, `src/patchers/canvas-patcher.ts:578` | Registration growth is visible in the code. Object retention and its magnitude need heap measurements; implement bounded lifecycle disposal and verify reload/undo cycles. |
| Portal refresh enumerates a Map with `Object.values` | `src/canvas-extensions/portals-canvas-extension.ts:87`, `src/@types/Canvas.d.ts` | Treat this as a scoped correctness candidate if portals are supported in the fork: iterate Map values, check the affected file first and test external updates. |
| Navigation can derive the selected element from the node/edge array offset | `src/patchers/canvas-patcher.ts:52`, `src/patchers/metadata-cache-patcher.ts:157` | A rendered projection or changed ordering can invalidate offsets. Establish stable-ID navigation before filtering removes/reorders live elements. |
| An A* route builds obstacles by scanning every node, and repeatedly scans them during search | `src/canvas-extensions/advanced-styles/edge-pathfinding-methods/pathfinding-a-star.ts:102`, `:189`, `:235`, `:243` | Measure routing separately; cache obstacle geometry, use spatial lookups and bounded route work. |
| The search loop has a 100 ms budget for each edge | `src/canvas-extensions/advanced-styles/edge-pathfinding-methods/pathfinding-a-star.ts:8`, `:172` | Multiple synchronous route tasks can accumulate into long stalls. Measure initialization outside that timer too; schedule across frames and retain deterministic fallback behavior. |
| Node changes can scan all edge bounding boxes for route invalidation | `src/canvas-extensions/advanced-styles/edge-styles.ts:118` | Use adjacency for endpoint-only routing and an index for obstacle-sensitive routes. |
| Edge rendering broadcasts the same change event used for real mutations | `src/patchers/canvas-patcher.ts:510` | Property/view indexes need mutation events or revision checks so rendering cannot trigger whole-graph filter work. |
| Selection highlighting toggles three classes for every edge | `src/canvas-extensions/edge-highlight-canvas-extension.ts:24` | Update only the difference between prior/current affected edge sets; benchmark the feature enabled and disabled. |
| Any canvas metadata change rewrites the start-node dataset over all nodes | `src/canvas-extensions/dataset-exposers/canvas-metadata-exposer.ts:19` | Saved-view edits should not trigger unrelated O(N) DOM work. Batch metadata writes and narrow listeners to the changed field. |
| All text nodes are submitted concurrently for metadata parsing after whole-file cache invalidation | `src/patchers/metadata-cache-patcher.ts:145` | Use per-element content hashes and bounded parsing concurrency while retaining links, frontmatter and navigation identity. |

These are source-observed costs or correctness candidates. Actual end-to-end timings, frame rates, memory retention and performance ceilings remain unmeasured.

### Projection and history requirements

Claude's review highlighted the interaction between full-model history and collapsed/portal projections. The plan now explicitly covers hidden endpoints, deletion of hidden incident edges, moving groups with hidden members, external reloads, view reapplication after undo and portal IDs. Initial view switching uses a visibility layer over the complete model. CSS hiding alone cannot establish a scale improvement: native maps, routing, selection, indexing and event work still need separate handling.

File-note metadata was suggested as a readily cached input during the review. The selected contract keeps node-instance properties independent; note metadata can be an optional read-only query namespace. This preserves the user's full property graph requirement when several nodes reference one note.

### Priority

1. Establish native round-trip behavior and the baseline benchmark harness.
2. Define/implement transactions, patch disposal and stable-ID navigation before property/view work expands.
3. Add incremental property parsing, pure predicates and complete-graph visibility behavior.
4. Optimize measured routing, group, indexing, DOM and history bottlenecks.
5. Introduce virtualization only after complete-model persistence and native culling are understood.

## Plan review and resolutions

Claude also reviewed the initial plan read-only and identified five omissions. They are resolved in the living plan:

1. Distinct predicate scopes for instance properties, native fields and optional read-only linked-note metadata; note metadata uses its own change/rename/delete invalidation.
2. One canonical storage model for all element types; existing leading YAML requires explicit undoable adoption. Plugin views/queries index properties; native global search exposure remains a declared contract decision.
3. Property-value wikilinks are opaque strings in the first release. Automatic backlinks and rename rewriting are deferred until a dedicated link contract exists.
4. Saved-definition edits are batched and undoable; active-view switching is always per-window and never writes the canvas. Regression tasks cover disk-writer/open-view races.
5. Native round-trip tests include the fork disabled, vanilla Obsidian and upstream Advanced Canvas, with exact compatibility retention/loss documented before committing a storage format.

Claude is idle after the planning review. Feature work awaits the next implementation task.
