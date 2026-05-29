import {
  createAuthorityWorld,
  expireCooldown,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  submitObjectEdit,
  type AuthorityWorld,
  type CompiledBuilderArtifact,
  type GenerationIntent,
  type GenerationStage,
  type GenerationStageEvent,
  type VoxelSourceArtifact,
} from "@3dvibegame/scene-authority-ts";

import {
  resolveScenarioFromPrompt,
  scenarios,
  type LifecycleScenario,
  type ScenarioActionId,
  type ScenarioKey,
} from "../fixtures/scenarios";
import { demoEventBus } from "../events/bus";
import { buildSceneDocument, createEmptySceneDocument } from "../state";
import type { SceneDocument } from "../state";

export type GenerationActionId = ScenarioActionId;

export interface GenerationSnapshot {
  playerId: string;
  document: SceneDocument;
  sourcePrompt: string;
  stage: GenerationStage;
  matchedScenarioKey: ScenarioKey;
  matchedScenarioLabel: string;
  matchedScenarioDescription: string;
  world: AuthorityWorld;
  object: AuthorityWorld["objects"][number] | null;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  plannedIntent: GenerationIntent | null;
  voxelArtifact: VoxelSourceArtifact | null;
  compiledArtifact: CompiledBuilderArtifact | null;
  availableActions: GenerationActionId[];
}

interface CachedObjectSession {
  source_prompt: string;
  matched_scenario_key: ScenarioKey;
  last_message: string;
  stage_events: GenerationStageEvent[];
  planned_intent: GenerationIntent | null;
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

interface CachedObjectArtifacts {
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

export function createGenerationSessionController(
  initialPrompt = scenarios.avatar_forge.sourcePrompt,
) {
  const playerId = "player_1";
  let world = buildInitialWorld();
  let document = createEmptySceneDocument(playerId);
  let activeObjectId: string | null = null;
  let sourcePrompt = initialPrompt;
  let stage: GenerationStage = "idle";
  let matchedScenarioKey = resolveScenarioFromPrompt(initialPrompt).key;
  let lastMessage = "Enter a prompt to generate the first avatar draft.";
  let stageEvents: GenerationStageEvent[] = [];
  let plannedIntent: GenerationIntent | null = null;
  let voxelArtifact: VoxelSourceArtifact | null = null;
  let compiledArtifact: CompiledBuilderArtifact | null = null;
  let objectArtifactsById: Record<string, CachedObjectArtifacts> = {};
  let objectSessionsById: Record<string, CachedObjectSession> = {};
  let requestSequence = 0;
  let eventSequence = 0;
  let timers: number[] = [];
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): GenerationSnapshot {
      const scenario = scenarios[matchedScenarioKey];
      const currentObject = resolveCurrentObject();

      return {
        playerId,
        document,
        sourcePrompt,
        stage,
        matchedScenarioKey,
        matchedScenarioLabel: scenario.label,
        matchedScenarioDescription: scenario.description,
        world,
        object: currentObject,
        lastMessage,
        stageEvents,
        plannedIntent,
        voxelArtifact,
        compiledArtifact,
        availableActions: resolveAvailableActions(currentObject, scenario),
      };
    },
    submitPrompt(prompt: string) {
      const trimmed = prompt.trim();

      clearTimers();
      resetSessionState();

      if (!trimmed) {
        sourcePrompt = "";
        stage = "failed";
        lastMessage = "Prompt is empty. Enter a request to generate your avatar.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      requestSequence += 1;
      sourcePrompt = trimmed;
      matchedScenarioKey = resolveScenarioFromPrompt(trimmed).key;
      const scenario = scenarios[matchedScenarioKey];
      const jobId = `${scenario.jobId}_${requestSequence}`;
      const objectId = `${scenario.objectId}_${requestSequence}`;

      try {
        const queued = requestCreateObject(world, {
          jobId,
          playerId: scenario.creatorId,
          sourcePrompt: trimmed,
        });
        world = queued.world;
        stage = "queued";
        lastMessage = `Queued your avatar prompt and matched the ${scenario.label.toLowerCase()} recipe.`;
        pushStageEvent("queued", lastMessage, "complete");
        syncDocument();
        notify();

        schedule(320, () => {
          plannedIntent = {
            ...scenario.plannedIntent,
            source_prompt: trimmed,
          };
          stage = "planning";
          lastMessage = `Structured the request into an ${plannedIntent.object_category} intent with ${plannedIntent.style_tags.join(", ")} style cues.`;
          pushStageEvent("planning", lastMessage, "complete");
          syncDocument();
          notify();
        });

        schedule(820, () => {
          voxelArtifact = {
            target: "voxel_source",
            summary: summarizeVoxelSource(scenario.voxelSource),
            payload: clonePayload(scenario.voxelSource),
            diagnostics: [...scenario.voxelSource.diagnostics],
          };
          stage = "voxel_source_ready";
          lastMessage = `Avatar voxel source ready with ${scenario.voxelSource.operations.length} ordered operations.`;
          pushStageEvent("voxel_source_ready", lastMessage, "complete");
          syncDocument();
          notify();
        });

        schedule(1420, () => {
          compiledArtifact = {
            target: "builder_spec",
            summary: summarizeCompiledArtifact(scenario.draftBuilder),
            payload: clonePayload(scenario.draftBuilder),
            diagnostics: [...scenario.draftBuilder.diagnostics],
          };
          pushStageEvent(
            "compiled_artifact_ready",
            `Compiled the avatar draft into ${scenario.draftBuilder.complexity.part_count} runtime parts.`,
            "complete",
          );

          const drafted = submitAIDraft(world, {
            jobId,
            objectId,
            creatorId: scenario.creatorId,
            builderSpec: scenario.draftBuilder,
            graceSeconds: scenario.graceSeconds,
          });
          world = drafted.world;
          activeObjectId = objectId;
          objectArtifactsById[objectId] = {
            voxel_artifact: voxelArtifact,
            compiled_artifact: compiledArtifact,
            diagnostics: [
              ...(voxelArtifact?.diagnostics ?? []),
              ...(compiledArtifact?.diagnostics ?? []),
            ],
          };

          stage = "grace";
          lastMessage = "Avatar draft is ready for inspection in the studio preview.";
          pushStageEvent("grace", lastMessage, "complete");
          syncDocument();
          notify();

          schedule(220, () => {
            const published = releaseObject(world, {
              objectId,
              playerId: scenario.creatorId,
            });
            world = published.world;
            stage = "released";
            lastMessage = "Published avatar version 1 to the player profile.";
            pushStageEvent("released", lastMessage, "complete");
            persistArtifactsForObject(objectId);
            syncDocument();
            notify();
          });
        });
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
      }
    },
    dispatch(actionId: GenerationActionId) {
      const object = resolveCurrentObject();
      const scenario = scenarios[matchedScenarioKey];

      if (!object) {
        lastMessage = "Generate an avatar first before submitting a refine step.";
        syncDocument();
        notify();
        return;
      }

      const nextStep = scenario.refineSteps.find((step) => step.actionId === actionId);
      const expectedAction = resolveAvailableActions(object, scenario)[0];

      if (!nextStep || expectedAction !== actionId) {
        lastMessage = "That refine step is not currently available for this avatar version.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      try {
        hydrateObjectSession(object.object_id);

        const locked = requestEditLock(world, {
          objectId: object.object_id,
          playerId,
          baseVersion: object.version,
        });
        world = locked.world;
        stage = "edit_locked";
        lastMessage = `Locked avatar version ${object.version} for ${nextStep.label.toLowerCase()}.`;
        pushStageEvent("edit_locked", lastMessage, "complete");

        const boundVoxel = createBoundVoxelArtifact(nextStep, object);
        const boundCompiled = createBoundCompiledArtifact(nextStep, object);

        voxelArtifact = boundVoxel;
        compiledArtifact = boundCompiled;

        const submitted = submitObjectEdit(world, {
          objectId: object.object_id,
          playerId,
          baseVersion: object.version,
          builderSpec: boundCompiled.payload,
        });
        world = submitted.world;
        objectArtifactsById[object.object_id] = {
          voxel_artifact: boundVoxel,
          compiled_artifact: boundCompiled,
          diagnostics: [
            ...boundVoxel.diagnostics,
            ...boundCompiled.diagnostics,
          ],
        };
        stage = "cooldown";
        lastMessage = `${nextStep.label} accepted as avatar version ${object.version + 1}.`;
        pushStageEvent("cooldown", submitted.event.message, "complete");

        const cooledDown = expireCooldown(world, {
          objectId: object.object_id,
        });
        world = cooledDown.world;
        stage = "released";
        lastMessage = `Avatar version ${object.version + 1} is now public and ready for the next refine step.`;
        pushStageEvent("released", cooledDown.event.message, "complete");
        persistArtifactsForObject(object.object_id);
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      }

      syncDocument();
      notify();
    },
    selectObject(objectId: string) {
      const object = world.objects.find((candidate) => candidate.object_id === objectId);
      if (!object) return;
      activeObjectId = object.object_id;
      hydrateObjectSession(object.object_id);
      syncDocument();
      notify();
    },
    deselectObject() {
      activeObjectId = resolveCurrentObject()?.object_id ?? activeObjectId;
      syncDocument();
      notify();
    },
    dispose() {
      clearTimers();
      listeners.clear();
    },
    beginHistoryBatch(batchId: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session) return;
      session.history.active_batch_id = batchId;
      notify();
    },
    commitHistoryBatch(batchId: string, label: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session) return;
      session.history.active_batch_id = null;
      session.history.entries = [
        {
          entry_id: batchId,
          label,
        },
        ...session.history.entries,
      ].slice(0, 20);
      notify();
    },
    cancelHistoryBatch(batchId: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session || session.history.active_batch_id !== batchId) return;
      session.history.active_batch_id = null;
      notify();
    },
  };

  function resetSessionState() {
    world = buildInitialWorld();
    document = createEmptySceneDocument(
      playerId,
      document.player_sessions_by_id[playerId] ?? null,
    );
    activeObjectId = null;
    plannedIntent = null;
    voxelArtifact = null;
    compiledArtifact = null;
    stageEvents = [];
    objectArtifactsById = {};
    objectSessionsById = {};
    stage = "idle";
    lastMessage = "Enter a prompt to generate the first avatar draft.";
  }

  function schedule(delayMs: number, callback: () => void) {
    const timer = window.setTimeout(() => {
      timers = timers.filter((candidate) => candidate !== timer);
      callback();
    }, delayMs);
    timers.push(timer);
  }

  function clearTimers() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  }

  function pushStageEvent(
    nextStage: GenerationStage,
    message: string,
    status: GenerationStageEvent["status"],
  ) {
    eventSequence += 1;
    stageEvents = [
      ...stageEvents,
      {
        id: `stage_event_${eventSequence}`,
        stage: nextStage,
        message,
        status,
        timestamp: new Date().toISOString(),
      },
    ].slice(-12);
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function syncDocument() {
    persistActiveObjectSession();

    const previousStage = document.player_sessions_by_id[playerId]?.generation_session?.stage;
    const previousFocusTarget =
      document.player_sessions_by_id[playerId]?.focus_target_object_id ?? null;

    document = buildSceneDocument({
      activeObjectId,
      selectedObjectId: activeObjectId,
      focusTargetObjectId: activeObjectId,
      objectArtifactsById,
      previousDocument: document,
      playerId,
      world,
      stage,
      matchedScenarioKey,
      lastMessage,
      stageEvents,
      plannedIntent,
      voxelArtifact,
      compiledArtifact,
      availableActions: resolveAvailableActions(
        resolveCurrentObject(),
        scenarios[matchedScenarioKey],
      ),
    });

    const nextFocusTarget =
      document.player_sessions_by_id[playerId]?.focus_target_object_id ?? null;
    const nextObjectId = activeObjectId ?? nextFocusTarget;

    if (previousStage !== stage) {
      demoEventBus.emit("generation:stage-changed", {
        player_id: playerId,
        stage,
        object_id: nextObjectId,
      });
    }

    if (previousFocusTarget !== nextFocusTarget) {
      demoEventBus.emit("viewer:focus-object", {
        player_id: playerId,
        object_id: nextFocusTarget,
      });
      demoEventBus.emit("object:selected", {
        player_id: playerId,
        object_id: nextFocusTarget,
      });
    }
  }

  function resolveCurrentObject() {
    if (!activeObjectId) {
      return null;
    }

    return world.objects.find((object) => object.object_id === activeObjectId) ?? null;
  }

  function hydrateObjectSession(objectId: string) {
    const cached = objectSessionsById[objectId];
    if (!cached) {
      return;
    }

    sourcePrompt = cached.source_prompt;
    matchedScenarioKey = cached.matched_scenario_key;
    lastMessage = cached.last_message;
    stageEvents = cached.stage_events;
    plannedIntent = cached.planned_intent;
    voxelArtifact = cached.voxel_artifact;
    compiledArtifact = cached.compiled_artifact;
  }

  function persistActiveObjectSession() {
    if (!activeObjectId) {
      return;
    }

    const diagnostics = objectArtifactsById[activeObjectId]?.diagnostics ?? [];
    objectSessionsById[activeObjectId] = {
      source_prompt: sourcePrompt,
      matched_scenario_key: matchedScenarioKey,
      last_message: lastMessage,
      stage_events: stageEvents,
      planned_intent: plannedIntent,
      voxel_artifact: voxelArtifact,
      compiled_artifact: compiledArtifact,
      diagnostics,
    };
  }

  function persistArtifactsForObject(objectId: string) {
    const diagnostics = objectArtifactsById[objectId]?.diagnostics ?? [];
    objectSessionsById[objectId] = {
      source_prompt: sourcePrompt,
      matched_scenario_key: matchedScenarioKey,
      last_message: lastMessage,
      stage_events: stageEvents,
      planned_intent: plannedIntent,
      voxel_artifact: voxelArtifact,
      compiled_artifact: compiledArtifact,
      diagnostics,
    };
  }
}

function buildInitialWorld(): AuthorityWorld {
  return createAuthorityWorld({
    worldId: "avatar_fixture_authority",
    settings: {
      visibility: "private",
      destructive_edits_enabled: false,
      object_cooldown_seconds: 3,
      protected_spawn_enabled: true,
    },
  });
}

function resolveAvailableActions(
  object: AuthorityWorld["objects"][number] | null,
  scenario: LifecycleScenario,
): GenerationActionId[] {
  if (!object || object.state !== "public") {
    return [];
  }

  const nextStep = scenario.refineSteps[object.version - 1];
  return nextStep ? [nextStep.actionId] : [];
}

function summarizeVoxelSource(spec: LifecycleScenario["voxelSource"]) {
  return [
    `${spec.operations.length} ops`,
    `${spec.materials.length} materials`,
    `${spec.placement.mode} placement`,
  ].join(" • ");
}

function summarizeCompiledArtifact(builder: LifecycleScenario["draftBuilder"]) {
  return [
    `${builder.complexity.part_count} parts`,
    `${builder.complexity.instance_count} instances`,
    `${builder.materials.length} materials`,
  ].join(" • ");
}

function createBoundVoxelArtifact(
  step: LifecycleScenario["refineSteps"][number],
  object: NonNullable<AuthorityWorld["objects"][number]>,
): VoxelSourceArtifact {
  const payload = clonePayload(step.voxelSource);
  payload.target_object_id = object.object_id;
  payload.base_object_version = object.version;

  return {
    target: "voxel_source",
    summary: summarizeVoxelSource(payload),
    payload,
    diagnostics: [...payload.diagnostics],
  };
}

function createBoundCompiledArtifact(
  step: LifecycleScenario["refineSteps"][number],
  object: NonNullable<AuthorityWorld["objects"][number]>,
): CompiledBuilderArtifact {
  const payload = clonePayload(step.builderSpec);
  payload.target_object_id = object.object_id;
  payload.base_object_version = object.version;

  return {
    target: "builder_spec",
    summary: summarizeCompiledArtifact(payload),
    payload,
    diagnostics: [...payload.diagnostics],
  };
}

function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
