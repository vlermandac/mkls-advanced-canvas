# Persistent canvas menu and relationship UI — 2026-10-14

Authored by Claude (LLM agent). This covers the UI half of [RELATION_MENU_BRIEF.md](RELATION_MENU_BRIEF.md). Codex owns the rules model, matching, persistence and edge creation. Build, type and lint checks only. No native inspection has been done yet. The assembled build is copied into QA only; its running window has not loaded it.

## Persistent menu (`src/property-graph/canvas-menu.ts`)

One container `.mkls-canvas-menu` per canvas view, inside `canvas.wrapperEl`. It sits outside the zoom/pan transform, docked at the top inline-start corner, and becomes a bottom sheet when the canvas is under 560 px wide (full width on phones). It is always present, whatever is selected.

| Part | Behavior |
| --- | --- |
| Bar: **View** | Shows the current view name (*All* when unfiltered; a filter icon in the accent colour when filtered). Opens a native menu: *All (complete canvas)*, one checked entry per saved view, *New view…*, and for the current view *Edit…*, *Duplicate…*, *Delete* (undoable), then *Export as a new canvas*. Write actions are disabled on read-only canvases. This replaces the former `.mkls-view-select` in the canvas controls |
| Bar: **Schema** | Opens `PropertySchemaCanvasExtension.openEditor(canvas)` for this exact canvas. Badge = number of node and edge fields; a warning icon when the schema cannot be read (it can still be opened to inspect) |
| Bar: **Rules** | Opens `RelationshipRulesCanvasExtension.openEditor(canvas)`. Badge = number of rules; a warning icon when the guidance cannot be read |
| **Properties** section | One selected node or edge: the existing property panel, unchanged (fields/YAML modes, drafts, stale handling, focus restoration, Esc/Enter, collapse and mode stored locally). Nothing selected: *Nothing selected*, with the hint "Select one card or edge to see and edit its properties." Several selected: *N selected*, with the hint "Properties are edited one element at a time." |

- Pointer, wheel, key and clipboard events inside the menu do not reach the canvas.
- Toolbar avoidance now measures the whole menu. After each native toolbar placement, the toolbar moves beside the menu (or above or below it) only if their rectangles intersect.
- Collapsing the Properties section leaves the bar and a one-line header.
- Editor callbacks find the extension instance in `plugin.canvasExtensions` by class, so a popout or inactive leaf opens the editor for its own canvas.

## Relationship chooser (`src/property-graph/relation-choice-menu.ts`)

`showRelationChoices(app, request)` opens a compact popover. It goes in the canvas window's document, at the drop point in client coordinates, and is clamped to the window. If there is no room below the drop point, it opens above it.

- **Contents:**
  - the title *Choose a relationship*;
  - the source → target card labels: first text line, file name, group label or link;
  - one row per choice, showing the type and "From <rule names>". Unnamed rules are counted.
- **Guidance wording:** "Suggested by this canvas's relationship rules. You can also connect without a type."
- **Actions:** *Connect without type* calls `choose(undefined)`, and *Cancel* calls `cancel()`.
- **Keys:** 1–9 pick a choice, and arrows or Tab move between rows. Esc cancels, and so does a pointer press outside the popover or the owner window losing focus. Keys do not reach the canvas.
- **Focus:** after Esc, *Cancel* or a choice, focus returns to the canvas if it was inside the chooser. An outside press or window blur leaves focus where the user put it.
- **Accessibility:** each chooser has its own title ID for `aria-labelledby`, so choosers in several canvas views don't collide.
- **Callbacks:** the UI is removed first, then exactly one of `choose` or `cancel` runs, once. The returned disposer closes the popover silently.
- **Not used:** an Obsidian `Menu`, because its click and hide order would risk calling cancel after a choice, and it shows rule names poorly.

## Connection previews in filtered views

The visibility patch treats an edge marked by `isConnectionPreview` (Codex, `connection-preview.ts`) as visible in every view, so the drag line stays visible in a filtered view. `schedule()` applies visibility to a preview and returns before marking it for the view index, so a provisional edge never enters it. The check that drops selected elements a view hides now uses the same `visible()` test, so a selected preview is not deselected.

## Rules editor (`src/property-graph/relation-rules-modal.ts`)

`new RelationRulesModal(app, current, save, remove?, suggest?)`. The optional `suggest(key, kind)` supplies autocomplete values; Codex supplies schema string options without scanning the graph.

- **Card type property** (default `kind`) and **Relationship property** (default `relation`), each with a short explanation.
- **Each rule is a card:**
  - optional name;
  - *When connecting from* [types] *to* [types] *offer* [relationships], as chip fields. Enter or a comma adds a chip, Backspace on an empty field removes the last one, and a duplicate is ignored;
  - a sentence summary, e.g. "Connecting a card whose kind is concept or term to one whose kind is example suggests "illustrated by"."
- **Buttons:** *Add rule*, *Remove rule*, *Cancel*, *Save rules*, and *Remove all rules* (only when `remove` is given).
- **Intro text:** rules suggest choices while connecting, never block a connection, and do not check existing edges.
- **Saving:** text typed but not yet turned into a chip is included. Empty names are dropped, then `validateRelationshipGuidance` runs, and its error is shown inline. Editing works on a deep copy, so rule IDs and unknown fields are kept; new rules get `crypto.randomUUID()`.

## Not yet done

- Native inspection of the menu, the chooser and the rules editor is still pending (2026-10-14).
  - Codex assembled `7.1.0-mkls.3` and copied it and `examples/relationship-guidance.canvas` into the MKLS Canvas QA vault only. The running QA window still has `7.1.0-mkls.2` loaded.
  - The Obsidian CLI reports "Unable to connect to main process". Main process 11677 still listens on its CLI socket, but `/run/user/1000/.obsidian-cli.sock` no longer exists on disk, and the app was started without a remote-debugging port.
  - The only remaining routes, restarting the shared main process or relaunching it, would also affect the open GCP vault window, so nothing was attempted. No QA state was changed.
  - To do once a QA-only route exists: reload the QA vault to load `.3`, then look once each at the menu (nothing selected, several selected, one selected, View menu, collapsed, narrow sheet), the Rules editor, and the chooser after dropping a new connection on the theorem → definition demo.
