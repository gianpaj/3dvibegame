import type {
  AuthorityWorld,
  CompiledBuilderArtifact,
  GenerationIntent,
  GenerationStage,
  GenerationStageEvent,
  VoxelSourceArtifact,
} from "@3dvibegame/scene-authority-ts";

import type { ScenarioKey } from "../fixtures/scenarios";
import type {
  GenerationSessionState,
  PlayerSessionState,
  SceneDocument,
  SceneObjectRecord,
} from "./contracts";

interface SceneObjectArtifacts {
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

interface BuildDocumentInput {
  activeObjectId?: string | null;
  selectedObjectId?: string | null;
  focusTargetObjectId?: string | null;
  objectArtifactsById?: Record<string, SceneObjectArtifacts>;
  previousDocument?: SceneDocument | null;
  playerId: string;
  world: AuthorityWorld;
  stage: GenerationStage;
  matchedScenarioKey: ScenarioKey;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  plannedIntent: GenerationIntent | null;
  voxelArtifact: VoxelSourceArtifact | null;
  compiledArtifact: CompiledBuilderArtifact | null;
  availableActions: string[];
}

export function createEmptySceneDocument(
  playerId: string,
  previousSession?: PlayerSessionState | null,
): SceneDocument {
  return {
    objects_by_id: {},
    root_object_ids: [],
    shared_dirty: {
      source_dirty_ids: [],
      artifact_dirty_ids: [],
      render_dirty_ids: [],
    },
    player_sessions_by_id: {
      [playerId]: createPlayerSession({
        playerId,
        previousSession,
        stage: "idle",
        matchedScenarioKey: "avatar_forge",
        lastMessage: "Enter a prompt to generate the first world object.",
        stageEvents: [],
        plannedIntent: null,
        availableActions: [],
      }),
    },
  };
}

export function buildSceneDocument(input: BuildDocumentInput): SceneDocument {
  const previousDocument = input.previousDocument ?? null;
  const previousSession = previousDocument?.player_sessions_by_id[input.playerId] ?? null;
  const artifactsById = input.objectArtifactsById ?? {};
  const objectsById = Object.fromEntries(
    input.world.objects.map((object) => {
      const cachedArtifacts = artifactsById[object.object_id];

      const record = {
        object_id: object.object_id,
        authority: object,
        voxel_artifact: cachedArtifacts?.voxel_artifact ?? null,
        compiled_artifact: cachedArtifacts?.compiled_artifact ?? null,
        diagnostics: cachedArtifacts?.diagnostics ?? [],
      } satisfies SceneObjectRecord;

      return [object.object_id, record];
    }),
  );

  const rootObjectIds = input.world.objects.map((object) => object.object_id);
  const renderDirtyIds = rootObjectIds.filter((objectId) => {
    const previousRecord = previousDocument?.objects_by_id[objectId];
    const nextRecord = objectsById[objectId];

    return (
      !previousRecord ||
      signatureOfRecord(previousRecord) !== signatureOfRecord(nextRecord)
    );
  });
  const artifactDirtyIds = rootObjectIds.filter((objectId) => {
    const previousRecord = previousDocument?.objects_by_id[objectId];
    const nextRecord = objectsById[objectId];

    return !previousRecord || signatureOfArtifact(previousRecord) !== signatureOfArtifact(nextRecord);
  });
  const sourceDirtyIds = rootObjectIds.filter((objectId) => {
    const previousRecord = previousDocument?.objects_by_id[objectId];
    const nextRecord = objectsById[objectId];

    return !previousRecord || signatureOfSource(previousRecord) !== signatureOfSource(nextRecord);
  });
  const focusTargetObjectId =
    input.focusTargetObjectId !== undefined
      ? input.focusTargetObjectId
      : input.activeObjectId ?? rootObjectIds[rootObjectIds.length - 1] ?? null;
  const previousFocusTarget = previousSession?.focus_target_object_id ?? null;

  return {
    objects_by_id: objectsById,
    root_object_ids: rootObjectIds,
    shared_dirty: {
      source_dirty_ids: sourceDirtyIds,
      artifact_dirty_ids: artifactDirtyIds,
      render_dirty_ids: renderDirtyIds,
    },
    player_sessions_by_id: {
      [input.playerId]: createPlayerSession({
        playerId: input.playerId,
        stage: input.stage,
        matchedScenarioKey: input.matchedScenarioKey,
        lastMessage: input.lastMessage,
        stageEvents: input.stageEvents,
        plannedIntent: input.plannedIntent,
        availableActions: input.availableActions,
        previousSession,
        focusTargetObjectId,
        selectedObjectId: input.selectedObjectId,
        cameraDirty:
          renderDirtyIds.length > 0 || focusTargetObjectId !== previousFocusTarget,
      }),
    },
  };
}

function createPlayerSession(input: {
  playerId: string;
  stage: GenerationStage;
  matchedScenarioKey: ScenarioKey;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  plannedIntent: GenerationIntent | null;
  availableActions: string[];
  previousSession?: PlayerSessionState | null;
  focusTargetObjectId?: string | null;
  selectedObjectId?: string | null;
  cameraDirty?: boolean;
}): PlayerSessionState {
  const generationSession = {
    source_prompt: input.plannedIntent?.source_prompt ?? "",
    stage: input.stage,
    matched_scenario_key: input.matchedScenarioKey,
    last_message: input.lastMessage,
    stage_events: input.stageEvents,
    planned_intent: input.plannedIntent,
    available_actions: input.availableActions,
  } satisfies GenerationSessionState;

  return {
    player_id: input.playerId,
    selection: {
      selected_object_id:
        input.selectedObjectId !== undefined
          ? input.selectedObjectId
          : input.focusTargetObjectId ?? input.previousSession?.selection.selected_object_id ?? null,
    },
    generation_session: generationSession,
    tool_state: {
      active_tool: input.previousSession?.tool_state.active_tool ?? "prompt_create",
    },
    history: {
      entries: input.previousSession?.history.entries ?? [],
      active_batch_id: input.previousSession?.history.active_batch_id ?? null,
    },
    camera_dirty: input.cameraDirty ?? false,
    focus_target_object_id: input.focusTargetObjectId ?? null,
  };
}

function signatureOfRecord(record: SceneObjectRecord) {
  return JSON.stringify({
    authority: record.authority,
    voxel_artifact: record.voxel_artifact,
    compiled_artifact: record.compiled_artifact,
  });
}

function signatureOfArtifact(record: SceneObjectRecord) {
  return JSON.stringify(record.compiled_artifact);
}

function signatureOfSource(record: SceneObjectRecord) {
  return JSON.stringify(record.voxel_artifact);
}
