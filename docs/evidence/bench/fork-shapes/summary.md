# Native benchmark fork 2026-10-12T22-24-16-658Z

- Text nodes only, except the opt-in "media" shape: local deterministic SVG files and Markdown notes embedding them (no raster images, PDFs, video, iframes or remote content).
- A* routing only when --astar-percent > 0 and never in native mode; fork/upstream route dirty edges on render, so with A* edges load and drags include routing.
- Load is file open inside a running Obsidian, not a cold application start.
- JS heap is performance.memory (Chromium, non-standard) without forced GC; treat as indicative.
- Frame timings depend on monitor refresh rate, window size and focus; idle frame baseline is reported for normalization.

| shape | nodes/edges | import ms | mounted ms | mounted nodes (1.0 / fit) | DOM (1.0) | heap MiB (1.0) | pan p95 ms 1.0 / fit | long tasks | first / warm filter ms | generic commit ms | YAML commit ms | graph/disk/history unchanged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dense | 1000/3000 | 219 | 5435 | 32.0 / 1000 | 8437 | 462 | 32.2 / 136 | 1.0 | 301 / 94.6 | 11.7 | 22.0 | true/true/true |
| grouped | 1049/3000 | 208 | 5714 | 12.0 / 1049 | 705 | 542 | 17.9 / 125 | 0.0 | 74.7 / 14.5 | 8.5 | 19.9 | true/true/true |
