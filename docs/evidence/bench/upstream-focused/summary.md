# Native benchmark upstream 2026-10-12T22-07-38-509Z

- Text nodes only, except the opt-in "media" shape: local deterministic SVG files and Markdown notes embedding them (no raster images, PDFs, video, iframes or remote content).
- A* routing only when --astar-percent > 0 and never in native mode; fork/upstream route dirty edges on render, so with A* edges load and drags include routing.
- Load is file open inside a running Obsidian, not a cold application start.
- JS heap is performance.memory (Chromium, non-standard) without forced GC; treat as indicative.
- Frame timings depend on monitor refresh rate, window size and focus; idle frame baseline is reported for normalization.

| shape | nodes/edges | import ms | mounted ms | mounted nodes (1.0 / fit) | DOM (1.0) | heap MiB (1.0) | pan p95 ms 1.0 / fit | long tasks | first / warm filter ms | generic commit ms | YAML commit ms | graph/disk/history unchanged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse | 10000/30000 | 1444 | 24150 | 12.0 / 2368 | 832 | 1109 | 14.4 / 347 | 0.0 | – / – | 63.4 | – | true/true/true |
