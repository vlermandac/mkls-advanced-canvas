# Persistent canvas menu and relationship guidance — 2026-10-14

Authored by Codex (LLM agent). User explicitly assigns all UI work to the existing Claude agent; Codex owns rules, persistence and edge creation. Continue in Advanced_Canvas on mkls-property-graph at da55f2d. Keep LLM provenance, own-fork only, no Impeccable, no tests/stress/benchmarks. Build/type/lint and bounded visual analysis are fine; QA only, no source/learner vault changes. Reuse the local-machine-context skill first if needed, then project AGENTS.md and docs.

## Claude ownership / UI

Own property-graph-canvas-extension.ts, property-panel.ts, property-graph.scss, and new UI modules/styles (keep imports in property-graph.scss to avoid shared styles.scss). Build one persistent floating top-left plugin menu: stays present when nothing or multiple elements are selected; offers Schema, Views (All, select/create/edit/duplicate/delete/export), Relationship rules and selected node/edge Properties. Preserve property draft/focus semantics, outside-transform positioning, collapse/small-screen behavior and toolbar avoidance. Remove the separate bottom/right mkls-view-select in favor of the persistent menu. One selection shows properties; otherwise show a useful selection hint. Define natural controls for endpoint rules, not formal logic text.

Also own src/property-graph/relation-rules-modal.ts and relation-choice-menu.ts (names below). Main/patcher/shared types/schema logic are Codex's; do not edit them concurrently. The existing schema modal is available as-is; you may improve it only if needed for the menu, but report that before editing.

## Rules / API contract (Codex implements)

metadata.propertyGraph.relationships?: RelationshipGuidance
RelationshipGuidance {version:1,nodeTypeKey:string,edgeTypeKey:string,rules:RelationshipRule[]}
RelationshipRule {id:string,name?:string,from:string[],to:string[],relations:string[]}
Names refer to literal top-level YAML properties, e.g. node kind / edge relation, or type / type. Native JSON Canvas type (text/file/group/link) is separate. A node type property may be a string or a list of strings. Matching is directed: from source types to target types. A match if one source type is in rule.from and one target type in rule.to. Matching rule choices combine by union, deduplicate type strings and retain contributing rule names/IDs. No wildcard or logical negation in v1. The user can later extend the model.

Rules are creation guidance only, not enforced constraints: existing edges, manual edits/imports and unmatched pairs remain possible. When a new connection is dragged onto a node and choices match, show the relation chooser. Clicking one creates the relation with that type property and native label. Include Create without type / dismiss semantics so guidance does not become hard enforcement. No matching rule -> native edge creation behavior. Cancelling the chooser removes only the newly created provisional connection, not an existing edge. Reconnecting existing edges never invokes this creation chooser. Source/target/rules/schema revisions are rechecked before applying a choice.

Exports from property-graph/relationships.ts:
- validateRelationshipGuidance(value:unknown): RelationshipGuidance throws field-located errors, preserves unknown recognized fields.
- relationshipGuidance(config:unknown): {status:'none'|'valid'|'unsupported',value?:RelationshipGuidance,error?:string} (config = canvas.metadata.propertyGraph).
- relationChoices(config:unknown,source:GraphElement,target:GraphElement): RelationChoice[]; choice {type:string,ruleIds:string[],ruleNames:string[]}.
Types exported from types.ts: RelationshipGuidance, RelationshipRule, RelationChoice.

## UI integration interfaces

Implement default export RelationRulesModal extends Modal in relation-rules-modal.ts:
constructor(app:App,current:RelationshipGuidance|undefined,save:(value:RelationshipGuidance)=>void,remove?:(()=>void)).
No current config -> initial {version:1,nodeTypeKey:'kind',edgeTypeKey:'relation',rules:[]}. Fields: node type property, edge relation property, rule name, From node type(s), To node type(s), Offer relation type(s). Add/remove rules, save/cancel/remove-all guidance. Explain that rules suggest choices and do not validate existing edges. Call validateRelationshipGuidance on save. Preserve IDs/unknown fields and caller guards.

Implement exported showRelationChoices(app:App,request:RelationChoiceRequest): ()=>void in relation-choice-menu.ts.
RelationChoiceRequest {canvas:Canvas,source:CanvasNode,target:CanvasNode,choices:RelationChoice[],position:{x:number,y:number},choose:(type:string|undefined)=>void,cancel:()=>void}.
Chooser may be Menu or a compact modal, with readable source/target labels, choices, guidance wording, Create without type action, and cancellation on outside/Esc. Return disposer closes UI; it must not call cancel after a successful choice. Place it at drop viewport/client coordinates. Core handles all writes/history, candidate cleanup and stale checks. Define/export the interface in your UI module; Codex imports it.

Main provides public PropertySchemaCanvasExtension.openEditor(canvas) (replaces private open; same existing command ID) and RelationshipRulesCanvasExtension.openEditor(canvas). For menu callbacks, import class types and find plugin.canvasExtensions instance to call them with this exact canvas, so popout/current-leaf mismatch does not open the wrong canvas. Existing view action methods in your extension can be adapted directly. Core imports and registers RelationshipRulesCanvasExtension in main.ts.

Start with the persistent menu and both UI modules while Codex implements types/rules/native hook. Report important API/layout choices early. Do not deploy or change native QA selection until coordinated; I am inspecting native source now. Write dated UX notes in planning/advanced-canvas/RELATION_MENU_UX.md; Codex maintains PLAN/WORKLOG and final package/docs.
