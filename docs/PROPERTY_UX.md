# Property editing UX — 2026-10-13

Authored by Claude (LLM agent). Analysis of the fork at d630418 and of Obsidian 1.14.4 behavior read from its `app.js`/`app.css`, followed by the implemented design. Build, type and lint checks pass. A short manual visual inspection of the deployed `7.1.0-mkls.2` build is recorded below; no automated or regression suite was run.

## Current workflow

| Element | How properties are edited today | Problems |
| --- | --- | --- |
| Text node | Double-click to edit body; a YAML textarea appears **above** the node, inside `nodeEl` | Collides with the native selection toolbar (screenshot); hidden unless editing; scales with zoom |
| File / link node | No inline editor; only the command **Edit selected node or edge frontmatter** | Not discoverable; no visible properties |
| Group | Same as file/link (command only) | Not discoverable |
| Edge | Editing the label opens a YAML panel in the label wrapper | Requires a label element; an empty label needs a `destroy` override to survive moving into YAML; returning to the body can destroy it |

Other observations: field creation means typing YAML by hand (no type choice, no hint that `false` and `"false"` differ). Errors appear only as a Notice and a hidden draft. There is no keyboard path into the panel apart from Tab from the body editor. At small zoom the panel is unreadable; on narrow windows it overflows the node.

## Native toolbar placement (measured from source)

`canvas.menu.containerEl` is appended to `canvas.wrapperEl` (screen space, not transformed). It is horizontally centred on the selection bbox with its bottom at `minY − 10/scale` canvas units (groups: `35/√scale`; edges: `30/√scale` or above the label), then clamped 10 px inside `canvasRect`. Any editor anchored above the selection is therefore in the toolbar's zone at every zoom. The card menu sits bottom centre and the canvas controls top inline-end; the top inline-start corner is free.

## Decision

One screen-space **Properties panel** docked at the top inline-start of the canvas view, outside the transform:

- Shown whenever exactly one node (any type) or edge is selected; collapsible, collapse state remembered locally. Bounded width and height with its own scroll; on narrow canvases it becomes a bottom sheet.
- A measured guard moves the native toolbar beside the panel only when their rectangles intersect.
- **Fields** mode: typed rows, an add-property form with explicit type choice, schema fields with required marks, descriptions, option menus and defaults offered as suggestions. Fields outside a closed schema stay visible under *Not in schema*.
- **YAML** mode: raw source, comments and formatting preserved; the source modal remains for YAML plus body.
- One commit path validates YAML and schema before writing. Invalid input is kept as the element's draft with inline, line-located errors and a discard action; stale element or schema revisions are refused and the draft retained in recovery storage.
- Edges no longer need a label to carry properties, which removes the empty-label special case.

Rendered node bodies and labels never show properties.

## Implemented behavior

| Situation | Behavior |
| --- | --- |
| Selection | Panel follows a single selected node (text, file, link, group) or edge; it hides on deselection, multi-selection or when a view hides the element. Native body and label editing are unchanged |
| No schema | Existing properties as typed rows; **Add property** with name, type (Text, Number, Checkbox, Date, List, Object) and a value control |
| Schema | Schema fields first, with type icon, required mark, description and option menus. Missing optional fields stay absent until edited; a default is a placeholder plus **Use default** or **Add N default values**. Other properties are listed under *Other properties*, or *Not in schema* for a closed schema, where adding is disabled |
| Types | A string `"false"` is never shown as a checkbox; a wrong-typed value is shown read-only with **Edit in YAML**. Numbers must be finite; an empty number field is an error rather than a delete; zero is a value. Missing booleans use *Not set / Checked / Unchecked* |
| YAML mode | Raw source including comments. Leaving the field or Ctrl/⌘+Enter applies; Esc reverts. The modal source editor (properties and body) stays one click away |
| Errors | One commit path: element and schema revision guard, YAML parse, schema validation. Failure keeps the last valid YAML and stores the input as the element's draft, with line-located or per-key errors and **Discard draft**. A draft that parses as a mapping remains editable as typed fields; syntax/non-mapping drafts require YAML correction or discard |
| Stale edits | If the element or schema changes while input is unsaved, the panel keeps the input, warns and refuses commits; refused input goes to recovery storage, and **Reload** shows the current version |
| Read-only | Read-only canvases, portal projections, unsupported records and an unreadable schema show values with a reason and accept no writes |
| Keyboard | Command **Focus properties of selected node or edge** expands the panel and focuses the first control. Enter applies a field, Esc reverts, and Tab moves between fields; focus is restored across re-renders. Keys, clipboard and wheel events inside the panel do not reach the canvas |
| Small canvases | Under 560 px the panel is a bottom sheet (45% height); on phones it spans the full width |
| Toolbar | After each native toolbar placement, the toolbar moves beside the panel (or below or above it) only if their rectangles intersect |

Field edits use the `yaml` document model, so comments and key order survive; untouched entries can be re-serialized in normalized form.

## Native visual inspection — 2026-10-13

Manual inspection by Claude (LLM agent) of `Demos/Property schema.canvas` in the MKLS Canvas QA vault, Obsidian 1.14.4, plugin `7.1.0-mkls.2` as deployed by Codex. The QA window sat on an unshown Hyprland workspace, so images were taken with Electron `capturePage` without changing the desktop; one capture returned a stale frame and was retaken. Selection, panning, mode switches and a few key and click events were sent through the Obsidian CLI. No property was written, and the demo file was only re-saved by Obsidian with identical content. These are single observations, not a test run. Screenshots are in `evidence/schema-ui/`.

| Observation | Result |
| --- | --- |
| Node selected (`01`) | Panel docked top-left, outside the zoom transform; schema rows show the required mark, description, option selects and the boolean default; the native toolbar sits above the node, clear of the panel |
| Node panned under the panel (`02`) | Toolbar placed beside the panel (toolbar left edge 380 px, panel right edge 372 px) instead of overlapping it; the panel covers part of the node, which stays selectable outside the panel |
| Edge selected (`03`) | Edge panel with required `relation` option, `weight` default placeholder, and the closed-schema hint; no label element needed |
| YAML mode (`04`) | Comment line shown; focus at the end of the source |
| Backspace in YAML and in the empty name field, Delete in the name field | Text edited in the field only; nodes, edges, selection and history unchanged. Esc reverted the YAML without a history entry |
| Click into the panel while editing a text node | Node stayed selected and in edit mode; focus moved to the panel field |
| Click on empty canvas (`05`) | Selection cleared and panel hidden; card bodies and the edge label show no properties |

Found and fixed after this inspection: the missing-boolean label "Not set (default false)" was truncated (now "Not set" plus a *Default:* line); value columns were misaligned between rows with and without a remove button; Esc left focus on the document body (now returns to the canvas). From Codex's source review: null booleans now show *Empty (null)* rather than an unchecked box, and option matching uses the schema's structural equality.

Issue found in the old QA window: it still held event listeners from an earlier plugin instance, and a stale handler threw on every text-node edit start and end. After the deselection click the node still reported `isEditing`, possibly a side effect of that error. The cause of the leftover listeners is unproven. Codex restarted the renderer with the vault-scoped `obsidian reload` and made plugin unload always complete even if flushing an editor fails. Afterwards one handler was registered for that event, none of them stale, and no errors were captured. The `isEditing` observation was not rechecked, because the follow-up was limited to a read-only look.

Follow-up look after the reload (`06`, selection only): the rebuilt panel shows "Not set" with *Default: draft* / *Default: false* lines, value columns aligned with and without a remove button, and **Add 2 default values**; the toolbar sits above the selected node, clear of the panel.

## Not yet inspected

- Toolbar avoidance with the panel collapsed, and the bottom-sheet layout (not inspected: the window was not resized).
- Ctrl+Z inside panel fields, and the draft flow for schema-incomplete edits (not inspected: both would write to the demo).
- Recovery-storage drafts are surfaced only by the source editor, not by the panel.
