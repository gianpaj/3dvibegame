export type ResponseType =
  | "scene_actions"
  | "scene_patch"
  | "clarification_request"
  | "refusal";

export type ActionType =
  | "add_object"
  | "remove_object"
  | "move_object"
  | "rotate_object"
  | "scale_object"
  | "set_material"
  | "set_color"
  | "duplicate_object"
  | "group_objects"
  | "ungroup_objects"
  | "replace_object"
  | "set_relation"
  | "clear_area"
  | "spawn_layout"
  | "annotate_constraint";

export type PositionMode = "absolute" | "relative";
export type Relation =
  | "left_of"
  | "right_of"
  | "behind"
  | "in_front_of"
  | "around";

export type PlanKind = "object_intent" | "clarification" | "refusal";
export type IntentOperation = "create" | "refine" | "remix";

export interface ObjectSpec {
  category: string;
  asset_id?: string | null;
  style?: string | null;
  variant?: string | null;
}

export interface PositionSpec {
  mode: PositionMode;
  reference_object?: string | null;
  relation?: Relation | null;
  offset_meters?: number | null;
  absolute?: number[] | null;
}

export interface TransformSpec {
  position?: PositionSpec | null;
  rotation?: number[] | null;
  scale?: number[] | null;
}

export interface AttributesSpec {
  color?: string | null;
  material?: string | null;
  count?: number | null;
  layout?: string | null;
}

export interface ConstraintSpec {
  grounded?: boolean | null;
  non_overlapping?: boolean | null;
  preserve_paths_clear?: boolean | null;
}

export interface SceneAction {
  action_type: ActionType;
  target?: string | null;
  object_spec?: ObjectSpec | null;
  transform?: TransformSpec | null;
  attributes?: AttributesSpec | null;
  constraints?: ConstraintSpec | null;
  references?: string[];
  confidence: number;
}

export interface Clarification {
  question: string;
  missing_fields: string[];
}

export interface Refusal {
  reason: string;
  safe_alternative?: string | null;
}

export interface Uncertainty {
  has_ambiguity: boolean;
  fields: string[];
}

export interface ScenePlanningResponse {
  schema_version: "1.0";
  response_type: ResponseType;
  actions?: SceneAction[] | null;
  patch?: Record<string, unknown> | null;
  clarification?: Clarification | null;
  refusal?: Refusal | null;
  notes?: string | null;
  uncertainty: Uncertainty;
}

export interface SceneObject {
  id: string;
  category: string;
  position: [number, number, number];
  tags?: string[];
}

export interface AllowedCatalog {
  categories: string[];
  action_types: ActionType[];
}

export interface SceneDefinition {
  scene_id: string;
  objects: SceneObject[];
  allowed_catalog: AllowedCatalog;
}

export interface PlanningRequest {
  request_id: string;
  scene: SceneDefinition;
  user_prompt: string;
  system_prompt: string;
  target_world_id?: string | null;
  target_object_id?: string | null;
  base_object_version?: number | null;
  response_schema: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LayoutHint {
  layout_type?: string | null;
  count?: number | null;
  reference_object?: string | null;
  relation?: Relation | null;
  metadata?: Record<string, unknown>;
}

export interface ObjectIntent {
  intent_id: string;
  operation: IntentOperation;
  target_object_id?: string | null;
  base_object_version?: number | null;
  category: string;
  size_tier?: string | null;
  parts: Record<string, unknown>[];
  material_palette?: Record<string, unknown> | null;
  behavior_presets: string[];
  transform_hints?: TransformSpec | null;
  style_tags: string[];
  instance_count: number;
  layout_hint?: LayoutHint | null;
  source_actions: ActionType[];
}

export interface NormalizedScenePlan {
  plan_version: string;
  request_id: string;
  plan_kind: PlanKind;
  source_response_type: ResponseType;
  uncertainty: Uncertainty;
  intents: ObjectIntent[];
  clarification?: Clarification | null;
  refusal?: Refusal | null;
  diagnostics: string[];
}

export interface PrimitiveNode {
  primitive: string;
  transform: Record<string, unknown>;
  material?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorldAnchor {
  mode: string;
  reference_object?: string | null;
  relation?: Relation | null;
  offset_meters?: number | null;
  absolute?: number[] | null;
}

export interface BoundsHint {
  size?: number[] | null;
  metadata?: Record<string, unknown>;
}

export interface RenderDraftSpec {
  draft_id: string;
  request_id: string;
  intent_id: string;
  display_name: string;
  primitive_nodes: PrimitiveNode[];
  world_anchor: WorldAnchor;
  bounds_hint?: BoundsHint | null;
  preview_materials: string[];
  animation_presets: string[];
  warnings: string[];
}

export interface PlanningOutcome {
  request_id: string;
  raw_output: string;
  parsed_response?: ScenePlanningResponse | null;
  schema_errors: string[];
  normalized_plan?: NormalizedScenePlan | null;
  render_drafts: RenderDraftSpec[];
  diagnostics: string[];
}

export interface RuntimeTaskArtifact {
  sample_id: string;
  task_id: string;
  adapter_name: string;
  raw_output: string;
  parsed_response?: ScenePlanningResponse | null;
  normalized_plan?: NormalizedScenePlan | null;
  render_drafts: RenderDraftSpec[];
  diagnostics: string[];
}
