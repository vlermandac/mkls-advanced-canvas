# Canvas schema and property editing work — 2026-10-13

Authored by Codex (LLM agent). User explicitly delegates the property UX/UI work to Claude and the edge typography/schema work to Codex.

This is the coordination contract used by Codex and Claude for the completed follow-up. The user retained the no-Impeccable rule and requested no further stress runs. Actual UX observations are in PROPERTY_UX.md; storage and user commands are in PROPERTY_GRAPH.md.

## Shared schema contract (Codex implements)

A canvas stores optional metadata.propertyGraph.schema alongside version1 and saved views. Schema itself: {version:1,nodes:{fields:[],allowAdditional:true},edges:{fields:[],allowAdditional:true}}. Fields are top-level literal keys: {key,type,description?,required?,nullable?,default?,options?}. Types: text, number, boolean, date, list, object. Date is a strict ISO calendar date string YYYY-MM-DD. Null is permitted only with nullable:true. Required means key presence (false/0/empty text count as present). options is a nonempty list of valid typed values. Unknown properties are allowed by default; allowAdditional:false explicitly closes a node/edge schema. A schema never silently deletes existing values or mass-rewrites records.

API from src/property-graph/schema.ts:
- schemaFor(config:unknown,kind:'nodes'|'edges') returns {status:'none'|'valid'|'unsupported',definition?:ElementSchema,error?:string}; pass canvas.metadata.propertyGraph.
- validatePropertyMap(values:PropertyMap,definition:ElementSchema): SchemaIssue[]; issue {key:string,message:string}.
- validateElementProperties(config:unknown,kind:'nodes'|'edges',values:PropertyMap): SchemaIssue[]. No schema -> []; unsupported -> blocking issue.
- schemaDefaults(definition:ElementSchema): PropertyMap (copied defined defaults only).
- applySchemaDefaults(yaml:string,definition:ElementSchema): {yaml:string,added:string[]} preserves YAML comments and existing values, fills only absent keys with defined defaults.
- validateSchema(value:unknown): CanvasPropertySchema throws located-by-field errors; preserves unknown fields of recognized version1 schemas.
Types are exported from property-graph/types.ts.

With no schema, offer free property creation with type selection plus YAML source. With schema, show predefined fields/type/required/default/options and supply suitable controls; missing optional fields stay absent unless explicitly added. Defaults are suggestions or an explicit apply-defaults action, not implicit commits on opening, schema creation or loading an old canvas. Support additional custom fields only when allowed; existing extra fields must remain visible/recoverable even with a closed schema. Never coerce string "false" to boolean or replace zero/missing with a default through truthiness.

All editor paths (inline properties, source modal, explicit legacy adoption) must validate schema before committing YAML. On schema mismatch preserve prior committed YAML and retain invalid draft/source with actionable errors, consistent with existing YAML recovery. Unknown/malformed schema is visible and read-only for property writes; do not silently treat it as no schema. Existing typed values stay unchanged if schema changes. Capture schema revision with the editor; refuse stale commit until reopened, preserving its draft.

Codex owns a schema creation/edit/removal command/modal and explicit apply-defaults-to-selection command, both batched/undoable and revision guarded. Coordinate imports with the API above. Report your chosen editor layout and any API adjustments before large edits; write a short dated UX analysis to planning/advanced-canvas/PROPERTY_UX_2026-10-13.md. No need to modify PLAN.md; Codex maintains it.
