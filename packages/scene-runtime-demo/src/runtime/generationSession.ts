import {
  createAuthorityWorld,
  getPrimaryObject,
  releaseObject,
  requestCreateObject,
  submitAIDraft,
  updateDraftTransform,
  type AuthorityWorld,
  type CompiledBuilderArtifact,
  type GenerationIntent,
  type GenerationStage,
  type GenerationStageEvent,
  type VoxelSourceArtifact,
} from "@3dvibegame/scene-authority-ts";

import { resolveScenarioFromPrompt, scenarios, type ScenarioKey } from "./scenarios";

export type GenerationActionId =
  | "nudge_draft"
  | "rotate_draft"
  | "scale_draft"
  | "release_object";

export interface GenerationSnapshot {
  sourcePrompt: string;
  stage: GenerationStage;
  matchedScenarioKey: ScenarioKey;
  matchedScenarioLabel: string;
  matchedScenarioDescription: string;
  world: AuthorityWorld;
  object: ReturnType<typeof getPrimaryObject>;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  plannedIntent: GenerationIntent | null;
  voxelArtifact: VoxelSourceArtifact | null;
  compiledArtifact: CompiledBuilderArtifact | null;
  availableActions: GenerationActionId[];
}

export function createGenerationSessionController(
  initialPrompt = scenarios.pine_lifecycle.sourcePrompt,
) {
  let world = buildInitialWorld();
  let sourcePrompt = initialPrompt;
  let stage: GenerationStage = "idle";
  let matchedScenarioKey = resolveScenarioFromPrompt(initialPrompt).key;
  let lastMessage = "Enter a prompt to start a staged object generation session.";
  let stageEvents: GenerationStageEvent[] = [];
  let plannedIntent: GenerationIntent | null = null;
  let voxelArtifact: VoxelSourceArtifact | null = null;
  let compiledArtifact: CompiledBuilderArtifact | null = null;
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

      return {
        sourcePrompt,
        stage,
        matchedScenarioKey,
        matchedScenarioLabel: scenario.label,
        matchedScenarioDescription: scenario.description,
        world,
        object: getPrimaryObject(world),
        lastMessage,
        stageEvents,
        plannedIntent,
        voxelArtifact,
        compiledArtifact,
        availableActions: resolveAvailableActions(world),
      };
    },
    submitPrompt(prompt: string) {
      const trimmed = prompt.trim();

      clearTimers();
      world = buildInitialWorld();
      plannedIntent = null;
      voxelArtifact = null;
      compiledArtifact = null;
      stageEvents = [];

      if (!trimmed) {
        sourcePrompt = "";
        stage = "failed";
        lastMessage = "Prompt is empty. Enter a request to generate a draft object.";
        pushStageEvent("failed", lastMessage, "error");
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
        lastMessage = `Queued prompt and matched the ${scenario.label.toLowerCase()} fixture path.`;
        pushStageEvent("queued", lastMessage, "complete");
        notify();

        schedule(320, () => {
          plannedIntent = {
            ...scenario.plannedIntent,
            source_prompt: trimmed,
          };
          stage = "planning";
          lastMessage = `Structured prompt into ${plannedIntent.object_category} intent with ${plannedIntent.placement.mode} placement.`;
          pushStageEvent("planning", lastMessage, "complete");
          notify();
        });

        schedule(880, () => {
          voxelArtifact = {
            target: "voxel_source",
            summary: summarizeVoxelSource(scenario),
            payload: scenario.voxelSource,
            diagnostics: [...scenario.voxelSource.diagnostics],
          };
          stage = "voxel_source_ready";
          lastMessage = `Voxel source ready with ${scenario.voxelSource.operations.length} ordered operations.`;
          pushStageEvent("voxel_source_ready", lastMessage, "complete");
          notify();
        });

        schedule(1480, () => {
          compiledArtifact = {
            target: "builder_spec",
            summary: summarizeCompiledArtifact(scenario),
            payload: scenario.draftBuilder,
            diagnostics: [...scenario.draftBuilder.diagnostics],
          };
          pushStageEvent(
            "compiled_artifact_ready",
            `Compiled voxel source into ${scenario.draftBuilder.complexity.part_count} runtime parts and ${scenario.draftBuilder.complexity.instance_count} instances.`,
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
          stage = "grace";
          lastMessage = drafted.event.message;
          pushStageEvent("grace", drafted.event.message, "complete");
          notify();
        });
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
        notify();
      }
    },
    dispatch(actionId: GenerationActionId) {
      const object = getPrimaryObject(world);
      const scenario = scenarios[matchedScenarioKey];

      if (!object) {
        lastMessage = "No active draft exists yet.";
        notify();
        return;
      }

      try {
        switch (actionId) {
          case "nudge_draft": {
            const result = updateDraftTransform(world, {
              objectId: object.object_id,
              playerId: scenario.creatorId,
              patch: {
                position: {
                  x: object.transform.position[0] + 0.45,
                  z: object.transform.position[2] - 0.3,
                },
              },
            });
            world = result.world;
            lastMessage = "Moved the draft within the grace window.";
            pushStageEvent("grace", lastMessage, "complete");
            break;
          }
          case "rotate_draft": {
            const result = updateDraftTransform(world, {
              objectId: object.object_id,
              playerId: scenario.creatorId,
              patch: {
                rotation: {
                  y: object.transform.rotation[1] + Math.PI / 8,
                },
              },
            });
            world = result.world;
            lastMessage = "Rotated the draft to inspect its silhouette before release.";
            pushStageEvent("grace", lastMessage, "complete");
            break;
          }
          case "scale_draft": {
            const nextScale = object.transform.scale[0] * 1.12;
            const result = updateDraftTransform(world, {
              objectId: object.object_id,
              playerId: scenario.creatorId,
              patch: {
                scale: {
                  x: nextScale,
                  y: object.transform.scale[1] * 1.12,
                  z: object.transform.scale[2] * 1.12,
                },
              },
            });
            world = result.world;
            lastMessage = "Scaled the draft up during grace.";
            pushStageEvent("grace", lastMessage, "complete");
            break;
          }
          case "release_object": {
            const result = releaseObject(world, {
              objectId: object.object_id,
              playerId: scenario.creatorId,
            });
            world = result.world;
            stage = "released";
            lastMessage = result.event.message;
            pushStageEvent("released", lastMessage, "complete");
            break;
          }
          default:
            actionId satisfies never;
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      }

      notify();
    },
    dispose() {
      clearTimers();
      listeners.clear();
    },
  };

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
      },
    ].slice(-10);
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }
}

function buildInitialWorld(): AuthorityWorld {
  return createAuthorityWorld({
    worldId: "world_fixture_authority",
    settings: {
      visibility: "public",
      destructive_edits_enabled: false,
      object_cooldown_seconds: 30,
      protected_spawn_enabled: true,
    },
  });
}

function resolveAvailableActions(world: AuthorityWorld): GenerationActionId[] {
  const object = getPrimaryObject(world);

  if (!object) {
    return [];
  }

  return object.state === "grace"
    ? ["nudge_draft", "rotate_draft", "scale_draft", "release_object"]
    : [];
}

function summarizeVoxelSource(
  scenario: (typeof scenarios)[keyof typeof scenarios],
) {
  return [
    `${scenario.voxelSource.operations.length} ops`,
    `${scenario.voxelSource.materials.length} materials`,
    `${scenario.voxelSource.placement.mode} placement`,
  ].join(" • ");
}

function summarizeCompiledArtifact(
  scenario: (typeof scenarios)[keyof typeof scenarios],
) {
  return [
    `${scenario.draftBuilder.complexity.part_count} parts`,
    `${scenario.draftBuilder.complexity.instance_count} instances`,
    `${scenario.draftBuilder.materials.length} materials`,
  ].join(" • ");
}
