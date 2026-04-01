import type { BuilderRelation, BuilderSpec } from "./contracts";
import type { VoxelBuilderSpec, VoxelVector3 } from "./voxel-contracts";

export type GenerationStage =
  | "idle"
  | "queued"
  | "planning"
  | "voxel_source_ready"
  | "compiled_artifact_ready"
  | "grace"
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
}

export type VoxelSourceArtifact = GenerationArtifact<
  "voxel_source",
  VoxelBuilderSpec
>;

export type CompiledBuilderArtifact = GenerationArtifact<
  "builder_spec",
  BuilderSpec
>;
