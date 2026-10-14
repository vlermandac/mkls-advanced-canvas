# Properties, saved graph views and relationship guidance

Authored by Codex (LLM agent). Storage versions 1; plugin `7.1.0-mkls.3`, minimum Obsidian 1.14.4. Earlier properties/schema integration was inspected on that version. The new connection hook uses its native implementation; native inspection of this follow-up is pending (see RELEASE.md). Private Canvas APIs are used; other versions need their own compatibility check.

## Canvas menu

The floating menu stays at the top-left of each canvas, outside its zoom transform. Its bar contains **Views**, **Schema** and **Rules**. Below it, **Properties** shows the selected node or edge. With no selection or several selected elements, it shows a selection hint. Collapsing Properties keeps the bar available. Narrow canvases use a bottom sheet.

## Editing

Select one node or edge to edit **Properties** in the persistent menu. The section scrolls within a bounded height and can collapse. Deselecting or selecting multiple elements replaces the fields with a hint. The native floating toolbar moves clear of the menu when their rectangles overlap. Rendered node bodies and edge labels never include the properties.

**Fields** mode provides typed values and an **Add property** form. **YAML** mode keeps raw source and comments: leaving the textarea or pressing Ctrl/⌘+Enter applies; Esc restores its prior value. Enter applies a field, Tab moves between fields, and **Focus properties of selected node or edge** offers a keyboard entry point. The source editor button or **Edit selected node or edge frontmatter** command opens YAML followed by the body.

File/link instances have their own properties; linked content is edited in the linked file. Two nodes referencing one note can have different values. Groups also have their own properties. Edge properties work even with no label. Portal projections are read-only and follow their local host's visibility; edit their source canvas. Collapsed groups stay collapsed while filtering; expand them to inspect member matches.

Edge labels use Obsidian's text font and text size settings, matching normal node-body text and its canvas zoom scaling. Per-node custom formatting such as Markdown headings remains local to the node.
```yaml
status: accepted
kind: theorem
score: 0
verified: false
tags: [linear-algebra, proof]
source: "[[My note]]"
```

Valid properties are a mapping of finite numbers, strings, booleans, null, lists and nested mappings. YAML 1.2 core semantics are used. Dates remain strings; predicates recognize strict ISO dates and zoned datetimes for ordering. Duplicate keys, non-finite numbers, cycles and unsupported YAML tags produce diagnostics. Raw YAML comments and formatting are preserved. A wikilink in a property is an opaque string; it is not indexed as an Obsidian backlink. These records are indexed for this plugin's views; the native global Properties/Bases engine does not index them.

Invalid YAML or a schema mismatch is retained as `draft` while committed YAML continues to drive views. A syntactically valid draft can still be completed in Fields mode, including several required fields one by one. Syntax/non-mapping errors use YAML mode. The panel shows the errors and a discard action. A valid property commit is one history action. Cancelling a changed source editor retains a recovery draft without changing the graph. Replaced panel editors retain YAML only, so recovery cannot bring back an old body. Recovered drafts are labelled; stale revisions require an explicit recovery action. Successful saves consume the recovery pointer, and a bounded archive retains the latest 20 drafts per element. Recovery files are under the plugin's `drafts/` directory and keyed by canvas path and element ID. Renaming a canvas does not relocate old recovery files; recover edits before renaming.

Existing text-node YAML is not automatically migrated. **Adopt selected text node frontmatter as properties** explicitly moves a leading `---` block into the property record and leaves its body. Adoption is undoable and refuses an existing property record.

## Canvas schemas

Click **Schema** in the canvas menu, or run **Edit canvas node and edge property schema**. Switch between **Nodes** and **Edges**, add fields, choose their names and types, and set descriptions, required/null rules, optional defaults and allowed values. **Save schema** stores the definition in this canvas; **Remove schema** keeps all element values, views and relationship rules. Each schema change is one undo action. An editor opened against an older schema cannot overwrite a newer one.

| Without a schema | With a schema |
| --- | --- |
| Add arbitrary named properties with a type and value | Predefined fields appear with their type, description and required marker |
| Values can be text, finite numbers, booleans, null, lists or objects | Values must match the declared type and optional allowed-value list |
| No required/default rules | Required means presence; zero, false and empty text count as values |
| Free additions | Additional fields are allowed by default; turn off **Allow additional properties** to close the schema |

Schema types are `text`, `number`, `boolean`, `date`, `list` and `object`. A date is a valid `YYYY-MM-DD` calendar string. Lists/objects accept finite JSON-compatible contents; their nested structure is not separately constrained by this first schema version. Names are literal top-level keys, including dots; they are not path expressions. Null requires **Allow null**; absence remains separate. Allowed values use an optional JSON list (for example `["accepted", "provisional"]`). Defaults use appropriate typed controls, with JSON for lists/objects.

Schema changes do not rewrite existing elements. Existing extra or wrong-typed values stay visible and can be corrected; a closed schema never deletes them. **Use default** or **Add N default values** fills absent fields explicitly in the panel. **Apply schema defaults to selected nodes and edges** applies valid changes to the selection as one action. Existing false/zero/null/empty values are never overwritten by defaults. That command refuses unresolved drafts or changes that would still violate the schema; complete those through the panel.

If several required fields are missing, the panel retains partial edits as a draft and lets you complete the typed fields. Once the whole draft meets the schema, it becomes committed properties and views update. Editing a body or schema during unsaved input refuses a stale property commit and keeps recovery data. Unsupported schema versions are preserved and property editing becomes read-only.

## Views

Use **Views** in the persistent menu to switch between **All** and saved views. The dropdown also creates, edits, duplicates, deletes and exports views; these actions remain available as commands. The initial editor uses JSON predicates for node and edge filters.

```json
{
  "kind": "condition",
  "scope": "properties",
  "path": ["status"],
  "operator": "equals",
  "value": "accepted"
}
```

`scope: "native"` accesses native fields such as `type`, `color`, `label`, `file`, `fromNode` or `toNode`. `propertyGraph` itself is excluded from this scope. Paths use literal string mapping keys and numeric array indices; no JavaScript execution, getters or inherited properties are used.

| Operator | Behavior |
| --- | --- |
| `exists`, `missing` | Distinguish an absent field from null, false, zero and empty strings |
| `equals`, `not-equals` | Strict typed structural equality |
| `contains` | List contains a typed value |
| `text-contains` | Case-sensitive substring match |
| `gt`, `gte`, `lt`, `lte` | Finite numbers or compatible explicit ISO date/datetime strings |

Combine conditions with `{"kind":"all","conditions":[...]}`, `any` or `none`. Empty all/none groups match; empty any does not. Property predicates on malformed committed YAML produce an unknown result, including under negation, so invalid data is not silently classified as missing. An omitted predicate matches all elements.

**Nodes mode** displays matching nodes, including isolates, and edges whose two endpoints are displayed and whose edge predicate matches. **Edges mode** displays matching edges and their endpoints; an explicit node predicate constrains those endpoints. Self-loops and parallel edges are supported.

Switching views changes display only: no graph, disk or history write. Saving and undo retain hidden records. Active view is per-canvas window memory and resets to All on reopening; saved definitions travel in the file. Editing a definition creates one history action. An editor refuses to overwrite definitions changed since it opened.

Selection and fit use visible elements. Native copy uses the selected records and native group semantics. **Export current view as a new canvas** exports matching elements and valid endpoint pairs; select All for a complete export. The source file is unchanged. Navigating to a hidden ID switches to All and selects the element. Native group dragging moves hidden members; deletion removes incident hidden edges and can be undone.

## Relationship guidance

Click **Rules**, or run **Edit canvas relationship rules**. Choose the node property that holds its type (default `kind`) and the edge property that holds the relationship (default `relation`). Add a rule using type chips:

> When connecting **theorem** to **definition**, offer **uses** or **supports**.

An optional rule name appears with its choices. Enter or a comma adds a chip; saving includes any text still in a chip input. Schema string options supply suggestions, and you can enter other values. **Save rules** and **Remove all rules** affect this canvas only and each use one undo action. They preserve schema, views and existing element values. Stale editors refuse to overwrite newer rules.

Draw a new connection from a matching source node to a matching target node. A chooser offers the matching relation types, **Connect without type**, and **Cancel**. Clicking a type creates the edge with that label and the configured relationship property. Keyboard shortcuts 1–9 select choices; arrows/Tab move focus and Esc cancels. Outside clicks and window blur also cancel. A cancelled choice leaves no graph record. A completed choice uses one creation transaction.

Rules use **committed** YAML properties. A node type may be a string or a list containing only strings. Values match exactly, including case. Direction matters: a reverse connection needs its own rule. Multiple matching rules contribute their union of choices, with duplicate types shown once and their rule names retained. The native JSON Canvas `type` (`text`, `file`, `link`, `group`) is separate from your type property. This version reads per-node properties; it does not infer types by following other edges or execute arbitrary logic.

The rules are advisory. Existing edges, manual property changes, imports and reconnecting an existing edge do not invoke or enforce them. With no matching rule, native connection creation proceeds normally. Dropping on empty space retains the native add-card/note menu. Portal projections are not eligible endpoints for guidance.

With an edge schema, a chosen type explicitly initializes its relationship property and fills absent schema defaults. Other missing required fields or a type outside the schema's options produce an editable draft in Properties. Complete it there; committed YAML continues to drive views. Without a schema, the chosen relationship commits directly. An untyped connection remains available even when a schema requires a relationship. Unsupported rule/schema versions are preserved; guidance that cannot safely write properties falls back to native creation.

See [the two-node demo](../examples/relationship-guidance.canvas). New connection previews remain visible under filters and are excluded from saved graph records and indexes until completed.

## Storage contract

The same record is stored on every node and edge:

```json
"propertyGraph": {"version": 1, "yaml": "status: accepted\n"}
```

An optional `draft` contains unapplied YAML or schema-invalid values. The parsed map is disposable, never a second persistent source of truth. Native `text`, `label`, `file`, IDs and positions remain native. Unknown fields within recognized version-1 records are preserved on editing. Unsupported versions and malformed records are preserved and refused for writes.

Canvas-level definitions are separate from upstream frontmatter:

```json
"metadata": {
  "version": "1.0-1.0",
  "frontmatter": {},
  "propertyGraph": {
    "version": 1,
    "views": [{"id":"accepted","name":"Accepted","mode":"nodes","nodes":{"kind":"condition","scope":"properties","path":["status"],"operator":"equals","value":"accepted"}}]
  }
}
```

An optional schema shares that configuration namespace, independently versioned:

```json
"schema": {
  "version": 1,
  "nodes": {
    "allowAdditional": true,
    "fields": [{"key":"status","type":"text","required":true,"default":"provisional","options":["accepted","provisional"]}]
  },
  "edges": {
    "allowAdditional": false,
    "fields": [{"key":"relation","type":"text","required":true}]
  }
}
```

Saving a schema preserves view definitions, relationship guidance and other namespace fields. Removing it preserves element properties. Unknown fields in recognized schemas/fields are retained; malformed or future schemas are shown read-only.

Optional relationship guidance shares that namespace and has its own version:

```json
"relationships": {
  "version": 1,
  "nodeTypeKey": "kind",
  "edgeTypeKey": "relation",
  "rules": [{
    "id": "theorem-definition",
    "name": "Theorem dependencies",
    "from": ["theorem"],
    "to": ["definition"],
    "relations": ["uses", "supports"]
  }]
}
```

Endpoint and relationship lists are nonempty, unique string values, with at most 200 per list and at most 200 rules. Rule IDs are unique. Property names are literal top-level keys. Unknown fields in recognized guidance/rules are preserved; malformed or future guidance opens read-only. New-connection previews are runtime state, never stored in this namespace.

Unrecognized view entries remain stored, although only valid definitions appear in the selector. Unknown configuration versions are not rewritten. The fork's schema version is independent of Advanced JSON Canvas's version.

Vanilla Obsidian 1.14.4 and unchanged upstream 7.1.0 retained node/edge properties and definitions during native edit/save and copy/paste checks. They do not implement this fork's properties/views behavior. Third-party JSON Canvas writers may discard extension fields; their compatibility must be checked separately.

This plugin does not rewrite the authoritative MKLS CSV graph, reconcile ingestion records, update Engram or alter linked notes. Query/bulk update commands are a later phase.

## Large graph option

**Simplify edges when zoomed out** is off by default. In the native overview, it hides arrowheads and edge hit areas and turns off edge stroke transitions. Lines remain visible, and zooming in restores edge selection and reconnection. It changes rendering only; graph, disk and history stay intact. The measured reduction helps but does not make large broad overviews smooth; see PERFORMANCE.md.

## Integration events

`advanced-canvas:element-properties-changed` emits `(canvas, element)` for native property-record writes. `advanced-canvas:edge-data-changed` emits for model writes, separately from the upstream rendering event. Move and resize events invalidate native geometry predicates. The cached index uses canonical records; foreign portal projections follow their host and do not become persisted canvas-owned records.

`advanced-canvas:new-connection-drop:before` emits `(canvas, edge, pointerEvent, control)` before the native new-edge completion saves. An extension can set `control.handled = true` and complete or cancel the provisional edge itself. Existing-edge reconnection does not emit this event.

The base node/edge format follows [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): stable unique string IDs and valid endpoint references. The extension namespaces are additional fields.
