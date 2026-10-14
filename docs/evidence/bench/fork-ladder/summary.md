# Native benchmark fork 2026-10-12T21-45-31-448Z

- Text nodes only, except the opt-in "media" shape: local deterministic SVG files and Markdown notes embedding them (no raster images, PDFs, video, iframes or remote content).
- A* routing only when --astar-percent > 0 and never in native mode; fork/upstream route dirty edges on render, so with A* edges load and drags include routing.
- Load is file open inside a running Obsidian, not a cold application start.
- JS heap is performance.memory (Chromium, non-standard) without forced GC; treat as indicative.
- Frame timings depend on monitor refresh rate, window size and focus; idle frame baseline is reported for normalization.

| shape | nodes/edges | import ms | mounted ms | mounted nodes (1.0 / fit) | DOM (1.0) | heap MiB (1.0) | pan p95 ms 1.0 / fit | long tasks | first / warm filter ms | generic commit ms | YAML commit ms | graph/disk/history unchanged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse | 100/300 | 70.9 | 399 | 12.0 / 100 | 753 | 56.3 | 14.3 / 14.3 | 0.0 | 54.2 / 11.3 | 1.3 | 4.8 | true/true/true |
| sparse | 1000/3000 | 226 | 5472 | 12.0 / 1000 | 741 | 91.6 | 17.8 / 104 | 0.0 | 75.4 / 17.6 | 6.0 | 22.1 | true/true/true |
| sparse | 5000/15000 | 803 | 19974 | 15.0 / 2180 | 894 | 277 | 14.3 / 336 | 0.0 | 286 / 48.5 | 20.0 | 66.0 | true/true/true |
| sparse | 10000/30000 | 1516 | 23653 | 12.0 / 2368 | 837 | 412 | 17.8 / 339 | 0.0 | 439 / 95.3 | 41.4 | 139 | true/true/true |
