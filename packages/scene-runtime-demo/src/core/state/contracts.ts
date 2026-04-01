import type {
  AuthorityObject,
  CompiledBuilderArtifact,
  GenerationIntent,
  GenerationStage,
  GenerationStageEvent,
  VoxelSourceArtifact,
} from "@3dvibegame/scene-authority-ts";

import type { ScenarioKey } from "../fixtures/scenarios";

export interface SceneSelectionState {
  selected_object_id: string | null;
}

export interface ToolState {
  active_tool: "prompt_create" | "inspect";
}

export interface HistoryEntry {
  entry_id: string;
  label: string;
}

export interface HistoryState {
  entries: HistoryEntry[];
  active_batch_id: string | null;
}

export interface GenerationSessionState {
  source_prompt: string;
  stage: GenerationStage;
  matched_scenario_key: ScenarioKey;
  last_message: string;
  stage_events: GenerationStageEvent[];
  planned_intent: GenerationIntent | null;
  available_actions: string[];
}

export interface PlayerSessionState {
  player_id: string;
  selection: SceneSelectionState;
  generation_session: GenerationSessionState | null;
  tool_state: ToolState;
  history: HistoryState;
  camera_dirty: boolean;
  focus_target_object_id?: string | null;
}

export interface SharedDirtyState {
  source_dirty_ids: string[];
  artifact_dirty_ids: string[];
  render_dirty_ids: string[];
}

export interface SceneObjectRecord {
  object_id: string;
  authority: AuthorityObject;
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

export interface SceneDocument {
  objects_by_id: Record<string, SceneObjectRecord>;
  root_object_ids: string[];
  shared_dirty: SharedDirtyState;
  player_sessions_by_id: Record<string, PlayerSessionState>;
}
