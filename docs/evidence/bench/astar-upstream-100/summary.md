# Native benchmark upstream 2026-10-12T23-01-07-954Z

- Text nodes only, except the opt-in "media" shape: local deterministic SVG files and Markdown notes embedding them (no raster images, PDFs, video, iframes or remote content).
- A* routing only when --astar-percent > 0 and never in native mode; fork/upstream route dirty edges on render, so with A* edges load and drags include routing.
- Load is file open inside a running Obsidian, not a cold application start.
- JS heap is performance.memory (Chromium, non-standard) without forced GC; treat as indicative.
- Frame timings depend on monitor refresh rate, window size and focus; idle frame baseline is reported for normalization.

| shape | nodes/edges | import ms | mounted ms | mounted nodes (1.0 / fit) | DOM (1.0) | heap MiB (1.0) | pan p95 ms 1.0 / fit | long tasks | first / warm filter ms | generic commit ms | YAML commit ms | graph/disk/history unchanged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse | 100/300 | 66.7 | 916 | 12.0 / 100 | 724 | 462 | 14.3 / 17.8 | 0.0 | – / – | 1.6 | – | true/true/true |
