# Advanced Canvas fork performance

Authored by Claude (LLM agent), 2026-10-12. Status: **native results measured for sparse 100–10k (all three modes; validated frame timings for sparse 10k in all modes and fork sparse 1k), fork dense and grouped at ≈1k, local media 100, the paired overview probe and A* routing at 100 nodes (upstream and fork, before route caching); A* measured with route statistics for the fork at 100 nodes (100%) and 1k nodes (10%); there is no valid upstream 1k A* result.** Only numbers in the result tables are native measurements; everything else is labelled as outside Obsidian. Frame-time comparisons use only validated runs (focused, unthrottled; see Validity).

## Measured so far (outside Obsidian)

| Measurement | Result | Scope |
| --- | --- | --- |
| Pure filter engine, 10k nodes / 30k edges | `evaluateView` 7.5–14.3 ms; incremental `ViewIndex` update ~2–8 µs per element; view switch ~10–15 ms | Node 24, pre-parsed property maps, no YAML/DOM (`bench/filter-benchmark.ts`) |
| Pure filter engine, 50k / 150k | `evaluateView` 48–112 ms; index load 337–433 ms | same |
| Canvas metadata re-index after one edit among 2k text nodes | 1 parse instead of 2,000; ≤ 8 concurrent parses | simulated parser (`tests/performance.test.ts`), not native time |
| Edge highlight, 200 selection changes on 30k edges | 2,517 element updates instead of 6,000,000 | simulated DOM counts |
| A* obstacle containment, 10k boxes × 100k points × inclusive/exclusive (`SpatialObstacles`) | naive `.some` 4,972 ms vs indexed 25 ms (198×); 8,719 vs 1.65 `insideBBox` checks per query; identical answers. With 1% group boxes and 5 giant boxes: 5,487 vs 31 ms (177×), 4.65 checks/query, 5 boxes in fallback | Node 24 (`bench/routing-benchmark.ts`); helper benchmark only. Since integrated into the fork's A* containment checks (obstacle collection and 100 ms route budget unchanged); native routing results are in the A* routing section below |

## Native benchmark

Script: `Advanced_Canvas/bench/native-benchmark.mjs`, same CLI-eval/report-file pattern as `tools/native-qa.mjs`.

Run from the fork checkout. Supply an existing, registered isolated QA vault under `evidence/`; keep its window visible. Repeat the benchmark command with `--mode upstream` and `--mode native` for the other modes. Upstream mode needs an unchanged upstream build installed in QA as `advanced-canvas`.

```bash
qa='../planning/advanced-canvas/evidence/MKLS Canvas QA'
```

```bash
node bench/native-benchmark.mjs \
  --vault "$qa" \
  --mode fork \
  --shapes sparse
```

Additional passes use `--shapes dense,grouped`, `--shapes media --sizes 100` or `--astar-percent 10`. The QA vault and retained fixtures are local artifacts, not included in the repository. See the reports in `docs/evidence/` for already completed runs.

Guards: vault folder name must contain `QA`, contain `.obsidian`, sit under an `evidence/` directory and not be a learner/source tree; the in-app code also checks the vault base path. Reports go to `evidence/bench/native-<mode>-<timestamp>/` (outside the vault, retained, one JSON per case plus `summary.json`/`summary.md`); fixtures are retained under the QA vault's `Bench/`. A lock file prevents two runs in one report directory. Plugins are switched with non-saving `disablePlugin`/`enablePlugin` and restored at the end. `--dry-run --out <dir>` only writes fixtures.

Fixtures (deterministic, seed 20261012; identical bytes across runs): 100/1,000/5,000/10,000 text nodes, 3 edges per node, five YAML properties per node and two per edge, three saved views in `metadata.propertyGraph`.
- **sparse**: grid, edges to nodes within ±3 rows/columns (includes some self-loops).
- **dense**: tighter grid, edges to random nodes anywhere (long, crossing SVG paths).
- **grouped**: sparse plus one group per 5×5 block (+4% nodes).
- **media** (opt-in, intended at 100 nodes): sparse layout where every 4th node is a file node showing a local SVG and every 4th+1 node a local Markdown note (frontmatter, embedded SVG, wikilink, math). Eight SVGs and eight notes are generated deterministically into the QA vault's `Bench/media/`; no remote content, raster images, PDFs or video.
Fixture sizes: ~110 KB (100) to ~11 MB (10k).

Per case it records: open and import time; time to stable mounted DOM (native virtualization mounts at most ten nodes per frame); mounted nodes/edges, DOM elements, SVG paths and JS heap at the initial, 100% and fit-all viewports; 180-frame scripted pans at 100% (3 screen widths) and fit zoom with frame p50/p95/max and long tasks; an idle-frame baseline; fork-only first (cold YAML parse + index) and warm filter switches with YAML parse counts, and a pan under an active view; SHA-256 of `getData()`, of the file on disk, and history length before and after the view switches; a generic one-property `setData` + history snapshot + save request (comparable across modes) and, in fork mode, the real YAML-panel blur commit; residual heap after closing.

Validity rules (recorded as `failures` in each report and shown in `summary.md`):
- Pan timings are invalid if the window is hidden or `requestAnimationFrame` is throttled: before each pan the script measures 30 idle frames with no viewport change and rejects the pan if their p50 exceeds 2× the run's idle baseline (minimum 20 ms) or 50 ms. `document.hasFocus()` alone is not a validity gate: Chromium throttles rAF for hidden/occluded pages, not for unfocused ones. A false `hasFocus` after focus restoration is recorded as a warning.
- Focus diagnosis (Obsidian 1.14.4 source): CLI `eval` runs through `openVaultById(id, false)` → `webContents.executeJavaScript` in the vault window's main frame without any focus call, so the global `document` is the canvas document (`sameDocumentAsGlobal` is recorded). `document.hasFocus()` reports Chromium page/webContents focus, which can be false while Hyprland reports the QA window active. Before each pan and before the YAML commit the script records `document.hasFocus()`, `activeElement`, and the Electron `BrowserWindow.isFocused()`, `isVisible()` and `webContents.isFocused()` via Obsidian's own `window.electronWindow`. If the page lacks focus it calls `electronWindow.focus()` (the same call Obsidian's own window focus uses) and `webContents.focus()`, then focuses the canvas wrapper, and records the state before and after. No input events are synthesized. Element `focus`/`blur` events only fire while the page has focus, so the YAML commit needs this restoration; without it, its validity check reports `INVALID`.
- The YAML commit is measured only after focusing the panel and confirming two frames later that it is `document.activeElement` and connected; `level` is set to a value that cannot already exist (max existing + 1000). It is valid only if the blur committed that value and advanced `history.current` by exactly one. History after leaving native editing is reported separately because native body editing can add its own entry. Invalid measurements show as `INVALID`, never as a time.

Known limits: media coverage is limited to the opt-in local SVG/Markdown shape; A* routing only with `--astar-percent` (fork/upstream route dirty edges on render, so load includes routing); load is a file open in a running app, not a cold start; heap without forced GC; frame times depend on refresh rate, window size and focus (keep the QA window visible and focused).

## Overview rendering probe

Script: `Advanced_Canvas/bench/overview-probe.mjs` (same guards, CLI-eval/report-file protocol and focus/idle-cadence validity as the benchmark). It opens one retained 1,000-node sparse fixture (newest `Bench/Bench-sparse-1000-*.canvas`, or `--fixture`), zooms to fit (clamped at −4, where native adds `mod-zoomed-out`), runs one unmeasured warm-up sweep so the sweep area is mounted, then measures the same 120-frame pan for paired variants in order `baseline, edge-lod, no-edges` × `--rounds`, followed by a final `baseline` to detect drift:

- **edge-lod**: under `.mod-zoomed-out`, `display: none` on `path.canvas-interaction-path` and `polygon.canvas-path-end`, and no transitions on edge paths. This is the candidate opt-in overview option.
- **no-edges**: all `.canvas-edges` layers and edge labels hidden. This is the upper bound for any edge-only fix: if this is not much faster than baseline, most of the overview cost lies elsewhere (node placeholders/DOM), and edge CSS would not be expected to solve it.

The CSS is a temporary `<style>` scoped to this canvas by a `data-mkls-overview-probe` attribute, removed in `finally`; removal and unchanged graph/disk/history hashes are verified and recorded. No plugin settings change and no plugins are toggled, so the probe measures the QA vault's current mode (enabled plugins are recorded). Because `display: none` does not change DOM query counts, each variant reports present vs **rendered** interaction paths, arrowheads, display paths and nodes, estimated from up to 400 evenly sampled elements per class with `checkVisibility()`, outside the timed sweep. The retained fixture may carry the earlier benchmark's single commit edits; all variants use the same loaded state.

```bash
node bench/overview-probe.mjs \
  --vault "$qa" \
  --rounds 2
```

Decision rule: ship an opt-in CSS overview option only if `edge-lod` improves fit-pan p50/p95 by a clear margin over both baselines (beyond baseline-to-baseline drift) across rounds; otherwise record why edge CSS does not solve the overview cost.

## Results

Environment for all native rows: Obsidian 1.14.4, Hyprland (Wayland), Ryzen 5 3600X, GTX 1660 SUPER, idle `requestAnimationFrame` p50 3.6 ms. Times in ms. Reports are retained in `evidence/bench/<run>/`. Heap is indicative only (no forced GC; 27–1,109 MiB across runs, varying more between runs than between modes) and is not compared.

### Validity

- **Validated runs** (current script: per-pan focus restoration and idle-cadence check, `hasFocus` true after restoration, no failures or warnings): `native-focused` (10k), `upstream-focused` (10k), `fork-optimized` (1k, 10k), `fork-shapes` (dense 1k, grouped 1k), `fork-media` (media 100), `overview-paired`, the six 100-node A* runs (`astar-{upstream,fork}-{0,10,100}`), `astar-fork-cached-visible-1000-10`, `astar-fork-final-100` and `astar-fork-final-1000-10`. Invalid runs (excluded entirely): `astar-upstream-1000-10` (interrupted, unclassified timeout), `astar-fork-1000-10` (harness interference) and `astar-fork-cached-1000-10` (hidden workspace).
- **Earlier ladders** (`native-ladder`, `upstream-ladder`, `fork-ladder`) ran with the earlier script without the idle-cadence check, and several native/upstream pans had `document.hasFocus()` false. Their **frame times are excluded from comparisons**. Their non-frame metrics (import, mounting, commit, filters, counts) do not depend on focus and are kept below for size scaling.
- Graph, disk and history hashes were unchanged across view switches, and around the overview probe, in every run. Every fork YAML commit was valid (panel focused, value committed, exactly one history entry).

### Mode comparison at 10k nodes / 30k edges (sparse; validated runs)

| | native | upstream 7.1.0 | fork (optimized) |
| --- | --- | --- | --- |
| import | 195 | 1,444 | 1,706 |
| mounted stable after open (opens at fit, zoom −4) | 15,582 | 24,150 | 24,204 |
| pan at 100% zoom, p50 / p95 | 10.7 / 17.9 | 10.7 / 14.4 | 10.7 / 17.9 |
| pan at fit zoom, p50 / p95 | 236 / 364 | 239 / 347 | 257 / 350 |
| mounted at fit: nodes / edges / SVG paths / DOM elements | 2,368 / 7,449 / 22,028 / 63,702 | 2,368 / 7,449 / 22,036 / 63,720 | 2,368 / 7,449 / 22,036 / 63,725 |
| generic one-property commit (setData + history snapshot + save request) | 14.7 | 63.4 | 35.1 |
| history snapshot size | 7.5 MB | 7.5 MB | 7.5 MB |

At 100% zoom every mode mounted 12 nodes and 79 edges (814–837 DOM elements).

### Fork, validated runs by size and shape

| run | nodes / edges | import | mounted stable | pan 100% p50 / p95 (mounted nodes / edges / DOM) | pan under active view p50 / p95 | pan fit p50 / p95 | first node filter (YAML parses) | warm same view | first edge filter (parses) | back to All | YAML commit | generic commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse 1k | 1,000 / 3,000 | 282 | 5,708 | 10.7 / 14.4 (12 / 63 / 741) | 3.6 / 7.2 | 86 / 114 | 94 (1,000) | 15 | 70 (3,000) | 20 | 21.5 | 8.8 |
| sparse 10k | 10,000 / 30,000 | 1,706 | 24,204 | 10.7 / 17.9 (12 / 79 / 837) | 3.6 / 7.2 | 257 / 350 | 494 (10,000) | 51 | 474 (30,000) | 52 | 98.7 | 35.1 |
| dense 1k | 1,000 / 3,000 | 219 | 5,435 | 14.3 / 32.2 (32 / 1,269 / 8,437) | 39.2 / 50.0 | 89 / 136 | 301 (1,000) | 95 | 94 (3,000) | 89 | 22.0 | 11.7 |
| grouped 1k | 1,049 (49 groups) / 3,000 | 208 | 5,714 | 10.7 / 17.9 (12 / 62 / 705) | 3.6 / 7.2 | 89 / 125 | 75 (1,049) | 14 | 61 (3,000) | 19 | 19.9 | 8.5 |
| media 100 | 100 / 300 | 45 | 486 | 7.1 / 28.5 (12 / 69 / 999) | 3.6 / 7.2 | 7.2 / 10.8 | 18 (100) | 10 | 16 (300) | 20 | 3.3 | 0.9 |

Shape qualifications: **dense** places edges between random nodes anywhere, so a 100% viewport crosses ~1,270 long edges (2,572 SVG paths) although only 32 nodes are mounted; its working-zoom p95 (32 ms) is an edge-rendering cost of that layout, not of node count. **grouped** adds one group node per 5×5 block of the sparse layout (49 groups at 1k); it was measured only at ≈1k nodes and only in fork mode, where its results were close to fork sparse 1k. **media** is 100 nodes where 25 are file nodes showing local SVGs and 25 are local Markdown notes embedding an SVG with a wikilink and math; the 28.5 ms p95 (max 68 ms) at 100% comes from media content mounting during the pan. No raster images, PDFs, video, iframes or remote content were measured, and media was measured only at 100 nodes. The "pan under active view" row pans at 100% with a filter active, so hidden elements are `display: none`; it is not comparable to the All-view pan.

Filter times are "two frames after `setView`". The script's "warm edge view" step is the first edge filter (its parse counts show edge YAML being parsed for the first time).

### Overview probe (paired, fork enabled, sparse 1k at fit zoom −4, 120-frame pan)

| # | variant | p50 | p95 | mean | long tasks (total ms) | rendered interaction paths / arrowheads / display paths |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | baseline | 89.2 | 107.1 | 84.6 | 56 (3,267) | 1,988 / 1,988 / 1,988 |
| 1 | edge-lod (interaction paths and arrowheads hidden, no edge transitions) | 67.9 | 82.2 | 66.8 | 6 (324) | 0 / 0 / 1,988 |
| 2 | no-edges (all edge layers hidden) | 60.8 | 82.0 | 60.7 | 2 (107) | 0 / 0 / 0 |
| 3 | baseline (drift check) | 85.7 | 117.9 | 85.2 | 54 (3,241) | 1,988 / 1,988 / 1,988 |

One round; probe CSS removed and graph/disk/history unchanged afterwards. The two baselines differ by 3.5 ms p50 and 11 ms p95, well below the edge-lod gain (−18 to −21 ms p50, −25 to −36 ms p95; long tasks 54–56 → 6). Hiding all edges gains only another 7 ms p50 and nothing at p95, so most of the remaining ~60–80 ms per frame at overview zoom lies outside the edge layers (most likely node-placeholder/DOM rendering, not profiled) and was not reduced further by hiding edges. Based on this the fork ships the `edge-lod` CSS as an **off-by-default** setting; it changes only rendering while zoomed out (edges cannot be clicked or dragged at that zoom, arrowheads are hidden) and never the canvas data. The probe measured one round at 1k; the setting's effect at 5k/10k was not separately measured.

### A* routing

Fixtures are the sparse layout with `styleAttributes.pathfindingMethod = "a-star"` on a deterministic share of edges; native mode ignores the attribute and was not run. Routing is time-bounded: each A* search gives up after 100 ms and the edge falls back to its default path, so routed geometry can depend on machine load (upstream retries on the edge's next render; the current fork retries a timed-out route after a 1 s cooldown). Path equality between modes was not verified. "Settled after open" is import plus the time until the mounted DOM stopped changing; initial routing of dirty A* edges happens in those first frames. All runs below are single runs.

**Final fork runs with route statistics** (current fork code: routes cached across ordinary pans, timeouts retried after 1 s, caching bypassed while collapsed groups are obstacles). Both completed with no errors, failures or warnings; focused and unthrottled; graph/disk/history unchanged. Route counters cover the whole benchmark case.

| run | nodes / edges (A* edges) | import | settled after open (frames) | pan 100% p50 / p95 | pan fit p50 / p95 | first node filter | YAML commit | route computations | cache hits | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `astar-fork-final-100` | 100 / 300 (300, 100%) | 77 | 834 (25) | 7.1 / 14.2 | 10.8 / 17.9 | 43 | 4.0 | 300 | 20 | 0 |
| `astar-fork-final-1000-10` | 1,000 / 3,000 (300, 10%) | 222 | 7,640 (115) | 10.7 / 14.3 | 89 / 118 | 85 | 17.5 | 313 | 2 | 0 |

Each A* edge was routed about once per case (300 computations for 300 edges at 100 nodes; 313 for 300 at 1k, i.e. 13 recomputations), and no route hit the 100 ms budget. Cache hits were few because edges re-render (and consult the router) only when marked dirty; ordinary pans do not re-render them.

**Comparisons (single runs, different builds; observations, not controlled differences):**
- 100 nodes, 100% A*: the final fork settled in 0.83 s; upstream settled in 0.92 s (`astar-upstream-100`). The earlier pre-cache fork run took 21.2 s (`astar-fork-100`); that build was not profiled, so the cause of the earlier stall is unknown. The final run shows one computation per edge and no timeouts.
- 1k nodes, 10% A*: the final fork settled in 7.6 s, against 5.7 s for the fork's 0% A* 1k run (`fork-optimized`, earlier build) and 9.5 s for the first valid cached run (`astar-fork-cached-visible-1000-10`, before the timeout/zoom/collapsed-group cache changes and without counters). Panning, filters and commits after settling were close to the 0% run. There is **no valid upstream 1k A* result**, so no comparison or speedup over upstream is claimed at 1k.

Earlier 100-node runs (before route caching; all valid):

| mode | A* edges | import | settled after open (frames) | pan 100% p50 / p95 | pan fit p50 / p95 | generic commit |
| --- | --- | --- | --- | --- | --- | --- |
| upstream | 0% | 39 | 369 (25) | 7.3 / 21.4 | 10.7 / 14.2 | 1.3 |
| upstream | 10% | 61 | 447 (25) | 10.6 / 14.3 | 10.7 / 10.8 | 2.0 |
| upstream | 100% | 67 | 916 (25) | 7.2 / 14.3 | 10.8 / 17.8 | 1.6 |
| fork (pre-cache) | 0% | 37 | 380 (25) | 7.2 / 17.8 | 10.7 / 14.3 | 1.2 |
| fork (pre-cache) | 10% | 60 | 426 (25) | 10.7 / 14.4 | 10.7 / 14.3 | 1.1 |
| fork (pre-cache) | 100% | 35 | 21,151 (25) | 7.1 / 17.9 | 10.8 / 17.9 | 1.3 |

Other valid 1k run: `astar-fork-cached-visible-1000-10` (first cached build, no counters): import 237, settled 9,501 (115 frames), pan 100% 10.7 / 17.8, pan fit 93 / 118, first filter 100, YAML commit 21.7.

**Invalid 1k runs** (not evidence about A* cost):

| run | what happened | classification |
| --- | --- | --- |
| `astar-upstream-1000-10` | Exceeded the driver's 600 s case timeout. The report has no phase timings, so it is unknown which phase was running (the timeout covers the whole case: idle baseline, open, settling, pans, commit). Stopped by disabling upstream and closing only its benchmark tab (`INTERRUPTED.md`). | invalid, unclassified; the duration is not attributed to routing |
| `astar-fork-1000-10` | Overlapped with the interrupted run's plugin restoration and failed to load the plugin. | invalid (harness interference) |
| `astar-fork-cached-1000-10` | Stalled in the initial idle-frame wait, **before** opening its canvas: the QA window had moved to another Hyprland workspace while `document.visibilityState` still reported `visible`, so animation frames stopped. After the QA window was focused, it immediately returned "deadline exceeded". | invalid (harness visibility/focus failure, not routing) |

Harness changes since these runs: an in-app deadline checked between frames (an overrunning case finishes and restores state before the driver gives up), initial page focus, and a 10 s animation-frame watchdog that fails the case instead of waiting. `visibilityState` alone did not detect the hidden workspace; the watchdog guards against it.

Route cache as implemented in the fork (from source): results are keyed by the shared model revision, endpoint boxes/positions/sides, routing method, zoom and the three path settings; "no path" results are cached; A* timeouts are distinguished and retried after a 1 s cooldown; caching is bypassed while collapsed groups (whose boxes come from DOM measurement) are obstacles. The shared revision over-invalidates (for example on label typing) but does not under-invalidate for the obstacle changes it tracks; separate geometry/edit counters remain a possible later optimization.

### Earlier ladders (non-frame metrics only)

| mode | nodes | import | mounted stable | generic commit | fit mounted nodes / edges / SVG paths |
| --- | --- | --- | --- | --- | --- |
| native | 100 / 1k / 5k / 10k | 19 / 53 / 113 / 207 | 136 / 3,041 / 14,177 / 15,613 | 0.6 / 3.9 / 11.4 / 15.0 | 100/300/926 · 1,000/3,000/9,026 · 2,180/6,972/20,510 · 2,368/7,449/22,028 |
| upstream 7.1.0 | 100 / 1k / 5k / 10k | 57 / 198 / 733 / 1,370 | 357 / 5,365 / 19,831 / 26,515 | 0.8 / 13.1 / 32.7 / 60.4 | same counts (±8 paths) |
| fork (before optimization) | 100 / 1k / 5k / 10k | 71 / 226 / 803 / 1,516 | 399 / 5,472 / 19,974 / 23,653 | 1.3 / 6.0 / 20.0 / 41.4 | same counts |

Fork before optimization, property features: first node filter 54 / 75 / 286 / 439 ms (100 / 1k / 5k / 10k), warm same view 11 / 18 / 48 / 95, YAML commit 4.8 / 22.1 / 66.0 / 139.1. After optimization (1k / 10k): warm same view 15 / 51, YAML commit 21.5 / 98.7; first filters not improved (75 → 94 at 1k, 439 → 494 at 10k). Each before/after figure is a **single run** on a desktop with uncontrolled background load; the differences are observations, not statistically established improvements or regressions.

### What the measurements show

1. **Overview cost: native rendering is the main limitation.** At 10k the fit-zoom pan is 236–257 ms p50 in all three modes with identical mounted counts (2,368 nodes, 7,449 edges, ~22k SVG paths, ~64k DOM elements). Comparable timings with and without either plugin point to native rendering as the main limitation; plugin hook overhead still exists (the fork's p50 was the highest of the three single runs) but is small relative to it. Fit zoom is clamped at −4, so from 1k nodes "fit" shows only part of the canvas, and after opening (which lands at fit) native mounts at most 10 nodes per frame while each frame costs 80–250 ms: 15.6 s (native) to 24.2 s (fork) until the mounted DOM is stable. The opt-in edge CSS reduced the 1k overview frame by ~20–25% in one paired probe round; most of the remaining cost was not affected by hiding edges.
2. **Working-zoom panning did not degrade with graph size in the measured sparse runs:** 100% pan p95 14.4–17.9 ms for fork sparse 1k and for sparse 10k in all three modes (12 nodes mounted). Grouped was measured only at ≈1k in fork mode (p95 17.9 ms). Dense long-edge layout at 1k and local media at 100 nodes were higher (p95 32 ms and 29 ms).
3. **Import is slower with either plugin.** 10k import: native 195 ms, upstream 1,444, fork 1,706 (≈8.7× native; +18% over upstream, single runs). The fork's import time was higher after the latest changes in these single runs and is a profiling target; it is still small next to the post-open mounting time.
4. **Commits.** A history snapshot at 10k is 7.5 MB. Generic commit: native 14.7 ms, upstream 63.4, fork 35.1. The fork's YAML commit was 98.7 ms at 10k (139.1 in the earlier single run; not a controlled comparison), above the generic path because the transaction serializes the whole graph for its no-op check and rollback.
5. **Filters.** First filters scale with the number of property records parsed: 494 ms for 10k node records (≈49 µs each, including index build and class updates) and 474 ms for 30k shorter edge records (≈16 µs each). Warm switches at 10k were ≈51 ms with the retained index (95 in the earlier single run; not a controlled comparison). Dense 1k is slower on filter switches (first 301 ms, warm 95, back to All 89); a likely but unprofiled cause is the ≈1,270 mounted edges restyled on each switch. Panning under an active view measured faster than the All view in the fork sparse, grouped (1k) and media (100) runs (p50 3.6 vs 7–11 ms), consistent with hidden elements not being rendered; dense was the exception (39 ms p50).

## Measured envelope and ceiling

Stated per measured shape; anything not listed is unmeasured.

- **Sparse plain-text canvases up to 10k nodes / 30k edges (fork; measured at 1k and 10k):** import ≈1.7 s; panning at 100% zoom p95 ≤ 18 ms; warm filter switch ≈50 ms; first node or edge filter ≈0.5 s; YAML property commit ≈0.1 s; generic commit ≈35 ms. Saved-view switching left graph, file and history unchanged in every run.
- **Grouped layout at ≈1k nodes (fork only; 1,049 nodes incl. 49 groups):** 100% pan p95 18 ms, first filter 75 ms, warm 14 ms, YAML commit 20 ms. Larger grouped canvases and other modes were not measured.
- **Dense long-edge layout at 1k:** 100% pan p95 32 ms, filter switches up to ≈300 ms (first) and ≈90 ms (warm). Larger dense canvases were not measured.
- **Local media (SVG files, Markdown embeds) at 100 nodes:** 100% pan p95 29 ms. Larger or raster/PDF/video/remote media were not measured.
- **Overview (fit zoom) from 1k nodes:** not interactive in any mode (p50 86–89 ms at 1k, 236–257 ms at 10k), plus 5–24 s of mounting after opening at fit. Comparable timings across modes point to native rendering as the main limitation. The off-by-default edge CSS lowered the 1k overview frame by ≈20–25%; it does not make overview interactive.
- **A\* routing (fork, current code):** at 100 nodes with 100% A* edges, settling after opening took 0.83 s (upstream 0.92 s); at 1k nodes with 10% A* edges, 7.6 s (vs 5.7 s for the fork's 0% A* 1k run, different build); each A* edge was routed about once and no route timed out in either run; panning, filters and commits after settling were unaffected. No valid upstream 1k A* result exists. Larger A* shares at 1k and A* above 1k nodes are unmeasured and unsupported.

Practical guidance from these numbers: canvases up to ≈10k sparse nodes are workable for editing at working zoom and for saved views; avoid overview navigation on large canvases (use views, search or links to jump), and expect the first filter per session to cost ≈0.5 s at 10k. The full MKLS graph (215k nodes, 343k edges) is ≈20× beyond the largest measured size and is not a supported single-canvas target; generated canvases should be subgraphs.

Profiling targets that remain: fork import overhead over upstream (+18% at 10k), background pre-parsing of property YAML to remove the first-filter cost, and the whole-graph serialization in property commits.

## Build provenance

The timing reports record the measured development builds, not a controlled rerun of every workload on the final artifact. A final serialization-cache consistency correction followed these measurements; all 89 final native preservation/interaction checks and 93 regressions pass after that correction. Routing logic is unchanged from the final stats-enabled runs. Raw local reports are retained unchanged; published copies normalize workspace path prefixes only.
