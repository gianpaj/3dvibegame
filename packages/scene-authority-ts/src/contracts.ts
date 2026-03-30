export type AuthorityObjectState =
  | "draft"
  | "grace"
  | "public"
  | "edit_locked"
  | "cooldown"
  | "archived"
  | "deleted";

export type AuthorityActionKind =
  | "request_create_object"
  | "submit_ai_draft"
  | "update_draft_transform"
  | "release_object"
  | "request_edit_lock"
  | "submit_object_edit"
  | "cancel_edit"
  | "expire_grace_period"
  | "expire_edit_lock"
  | "expire_cooldown";

export type BuilderOperation = "create" | "refine" | "remix";
export type BuilderRelation =
  | "left_of"
  | "right_of"
  | "behind"
  | "in_front_of"
  | "around";

export interface BuilderPart {
  part_id: string;
  primitive: string;
  material: string;
  dimensions: [number, number, number];
  modifiers: string[];
}

export interface BuilderInstance {
  instance_id: string;
  anchor_mode: "absolute" | "relative" | string;
  reference_object?: string | null;
  relation?: BuilderRelation | null;
  offset: [number, number, number];
}

export interface BuilderPlacement {
  mode: "absolute" | "relative" | string;
  reference_object?: string | null;
  relation?: BuilderRelation | null;
  offset_meters?: number | null;
}

export interface BuilderComplexity {
  part_count: number;
  instance_count: number;
  behavior_count: number;
}

export interface BuilderSpec {
  builder_version: string;
  request_id: string;
  intent_id: string;
  operation: BuilderOperation;
  target_object_id?: string | null;
  base_object_version?: number | null;
  object_category: string;
  size_tier: string;
  parts: BuilderPart[];
  instances: BuilderInstance[];
  attachments: Record<string, unknown>[];
  materials: string[];
  behaviors: string[];
  placement: BuilderPlacement;
  complexity: BuilderComplexity;
  diagnostics: string[];
}

export interface AuthorityTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface AuthorityWorldSettings {
  visibility: "public" | "private";
  destructive_edits_enabled: boolean;
  object_cooldown_seconds: number;
  protected_spawn_enabled: boolean;
}

export interface AuthorityJob {
  job_id: string;
  world_id: string;
  player_id: string;
  source_prompt: string;
  status: "pending" | "completed";
}

export interface AuthorityObject {
  object_id: string;
  world_id: string;
  state: AuthorityObjectState;
  version: number;
  created_by: string;
  latest_editor: string;
  grace_owner_id?: string | null;
  lock_owner_id?: string | null;
  builder_spec: BuilderSpec;
  transform: AuthorityTransform;
  cooldown_remaining_seconds: number;
  grace_remaining_seconds: number;
}

export interface AuthorityEvent {
  id: string;
  kind: AuthorityActionKind;
  object_id?: string | null;
  player_id?: string | null;
  message: string;
}

export interface AuthorityWorld {
  world_id: string;
  settings: AuthorityWorldSettings;
  jobs: AuthorityJob[];
  objects: AuthorityObject[];
  events: AuthorityEvent[];
}

export interface DraftTransformPatch {
  position?: Partial<Record<"x" | "y" | "z", number>>;
  rotation?: Partial<Record<"x" | "y" | "z", number>>;
  scale?: Partial<Record<"x" | "y" | "z", number>>;
}

export interface AuthorityActionResult {
  world: AuthorityWorld;
  event: AuthorityEvent;
}
