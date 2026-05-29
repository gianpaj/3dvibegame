import type { BuilderRelation, BuilderSpec } from "./contracts";
import type { ConversationContext } from "./conversation-thread";
import type { VoxelBuilderSpec, VoxelVector3 } from "./voxel-contracts";

export type GenerationStage =
  | "idle"
  | "queued"
  | "planning"
  | "voxel_source_ready"
  | "compiled_artifact_ready"
  | "grace"
  | "edit_locked"
  | "cooldown"
  | "released"
  | "failed";

export interface GenerationPlacementIntent {
  mode: "absolute" | "relative" | string;
  reference_object?: string | null;
  relation?: BuilderRelation | null;
  offset: VoxelVector3;
}

export interface GenerationIntent {
  source_prompt: string;
  object_category: string;
  size_tier: string;
  style_tags: string[];
  behaviors: string[];
  placement: GenerationPlacementIntent;
  notes: string[];
  /**
   * Multi-turn conversation context passed to the AI worker on follow-up prompts.
   * Null on the first prompt in a session (no prior context).
   * The AI uses this to resolve references ("it", "the car", "a longer one") and
   * understand what was previously rejected on "replace" intents.
   */
  conversation_context: ConversationContext | null;
}

export interface GenerationArtifact<TTarget extends string, TPayload> {
  target: TTarget;
  summary: string;
  payload: TPayload;
  diagnostics: string[];
}

export interface GenerationStageEvent {
  id: string;
  stage: GenerationStage;
  message: string;
  status: "pending" | "complete" | "error";
  timestamp: string;
}

export type VoxelSourceArtifact = GenerationArtifact<
  "voxel_source",
  VoxelBuilderSpec
>;

export type CompiledBuilderArtifact = GenerationArtifact<
  "builder_spec",
  BuilderSpec
>;
