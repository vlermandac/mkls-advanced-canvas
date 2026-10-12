# Properties and saved graph views

Authored by Codex (LLM agent). Storage version 1; plugin `7.1.0-mkls.1`, minimum Obsidian 1.14.4. Native integration checked on that version. Private Canvas APIs are used; other versions need their own compatibility check.

## Editing

While editing a text node or edge label, its frontmatter appears in a separate YAML textarea delimited by `---`. Moving focus into that field keeps it open. Blur commits valid YAML, and clicking out hides it. Native body text and labels remain content without a YAML prefix.

Select any single node or edge and run **Edit selected node or edge frontmatter** for a source editor containing YAML followed by its body. File/link instances accept properties here; their content is edited in the linked file. Two nodes referencing the same note can have different properties. Group labels also retain their own properties. Portal projections are read-only and follow their local host's visibility; edit their source canvas. Collapsed groups stay collapsed while filtering; expand them to inspect member matches.

```yaml
status: accepted
kind: theorem
score: 0
verified: false
tags: [linear-algebra, proof]
source: "[[My note]]"
```

Valid properties are a mapping of finite numbers, strings, booleans, null, lists and nested mappings. YAML 1.2 core semantics are used. Dates remain strings; predicates recognize strict ISO dates and zoned datetimes for ordering. Duplicate keys, non-finite numbers, cycles and unsupported YAML tags produce diagnostics. Raw YAML comments and formatting are preserved. A wikilink in a property is an opaque string; it is not indexed as an Obsidian backlink. These records are indexed for this plugin's views; the native global Properties/Bases engine does not index them.

Invalid inline YAML is retained as `draft` while committed YAML continues to drive views. A valid property commit is one history action. Cancelling a changed source editor retains a recovery draft without changing the graph. Replaced or unloaded inline editors retain YAML only, so recovery cannot bring back an old body. Recovered drafts are labelled; stale revisions require an explicit recovery action. Successful saves consume the recovery pointer, and a bounded archive retains the latest 20 drafts per element. Recovery files are under the plugin's `drafts/` directory and keyed by canvas path and element ID. Renaming a canvas does not relocate old recovery files; recover edits before renaming.

Existing text-node YAML is not automatically migrated. **Adopt selected text node frontmatter as properties** explicitly moves a leading `---` block into the property record and leaves its body. Adoption is undoable and refuses an existing property record.

## Views

Use the canvas selector to switch between **All** and saved views. Commands create, edit, duplicate or delete definitions. The initial editor uses JSON predicates for node and edge filters.

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

## Storage contract

The same record is stored on every node and edge:

```json
"propertyGraph": {"version": 1, "yaml": "status: accepted\n"}
```

An optional `draft` contains invalid inline YAML. The parsed map is disposable, never a second persistent source of truth. Native `text`, `label`, `file`, IDs and positions remain native. Unknown fields within recognized version-1 records are preserved on editing. Unsupported versions and malformed records are preserved and refused for writes.

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

Unrecognized view entries remain stored, although only valid definitions appear in the selector. Unknown configuration versions are not rewritten. The fork's schema version is independent of Advanced JSON Canvas's version.

Vanilla Obsidian 1.14.4 and unchanged upstream 7.1.0 retained node/edge properties and definitions during native edit/save and copy/paste checks. They do not implement this fork's properties/views behavior. Third-party JSON Canvas writers may discard extension fields; their compatibility must be checked separately.

This plugin does not rewrite the authoritative MKLS CSV graph, reconcile ingestion records, update Engram or alter linked notes. Query/bulk update commands are a later phase.

## Large graph option

**Simplify edges when zoomed out** is off by default. In the native overview, it hides arrowheads and edge hit areas and turns off edge stroke transitions. Lines remain visible, and zooming in restores edge selection and reconnection. It changes rendering only; graph, disk and history stay intact. The measured reduction helps but does not make large broad overviews smooth; see PERFORMANCE.md.

## Integration events

`advanced-canvas:element-properties-changed` emits `(canvas, element)` for native property-record writes. `advanced-canvas:edge-data-changed` emits for model writes, separately from the upstream rendering event. Move and resize events invalidate native geometry predicates. The cached index uses canonical records; foreign portal projections follow their host and do not become persisted canvas-owned records.

The base node/edge format follows [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): stable unique string IDs and valid endpoint references. The extension namespaces are additional fields.
