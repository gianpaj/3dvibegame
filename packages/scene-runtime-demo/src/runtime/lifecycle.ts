import {
  cancelEdit,
  createAuthorityWorld,
  expireCooldown,
  expireEditLock,
  expireGracePeriod,
  getPrimaryObject,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  submitObjectEdit,
  updateDraftTransform,
  type AuthorityWorld,
} from "@3dvibegame/scene-authority-ts";

import { scenarios, type ScenarioKey } from "./scenarios";

export type LifecycleActionId =
  | "queue_create"
  | "submit_ai_draft"
  | "nudge_draft"
  | "scale_draft"
  | "release_object"
  | "expire_grace"
  | "request_edit_lock"
  | "submit_object_edit"
  | "cancel_edit"
  | "expire_edit_lock"
  | "expire_cooldown";

export interface LifecycleSnapshot {
  scenarioKey: ScenarioKey;
  label: string;
  description: string;
  sourcePrompt: string;
  world: AuthorityWorld;
  object: ReturnType<typeof getPrimaryObject>;
  lastMessage: string;
  availableActions: LifecycleActionId[];
}

export function createLifecycleController(initialScenarioKey: ScenarioKey) {
  let currentScenarioKey = initialScenarioKey;
  let world: AuthorityWorld = buildInitialWorld();
  let lastMessage = "Ready to register the first create request.";

  return {
    getSnapshot() {
      const scenario = scenarios[currentScenarioKey];
      const object = getPrimaryObject(world);

      return {
        scenarioKey: currentScenarioKey,
        label: scenario.label,
        description: scenario.description,
        sourcePrompt: scenario.sourcePrompt,
        world,
        object,
        lastMessage,
        availableActions: resolveAvailableActions(world),
      } satisfies LifecycleSnapshot;
    },
    selectScenario(nextScenarioKey: ScenarioKey) {
      currentScenarioKey = nextScenarioKey;
      world = buildInitialWorld();
      lastMessage = "Switched scenario and reset authoritative world state.";
      return this.getSnapshot();
    },
    dispatch(actionId: LifecycleActionId) {
      const scenario = scenarios[currentScenarioKey];

      try {
        switch (actionId) {
          case "queue_create": {
            const result = requestCreateObject(world, {
              jobId: scenario.jobId,
              playerId: scenario.creatorId,
              sourcePrompt: scenario.sourcePrompt,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "submit_ai_draft": {
            const result = submitAIDraft(world, {
              jobId: scenario.jobId,
              objectId: scenario.objectId,
              creatorId: scenario.creatorId,
              builderSpec: scenario.draftBuilder,
              graceSeconds: scenario.graceSeconds,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "nudge_draft": {
            const result = updateDraftTransform(world, {
              objectId: scenario.objectId,
              playerId: scenario.creatorId,
              patch: {
                position: { x: 0.5, z: -0.35 },
                rotation: { y: 0.2 },
              },
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "scale_draft": {
            const result = updateDraftTransform(world, {
              objectId: scenario.objectId,
              playerId: scenario.creatorId,
              patch: {
                scale: { x: 1.15, y: 1.15, z: 1.15 },
              },
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "release_object": {
            const result = releaseObject(world, {
              objectId: scenario.objectId,
              playerId: scenario.creatorId,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "expire_grace": {
            const result = expireGracePeriod(world, {
              objectId: scenario.objectId,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "request_edit_lock": {
            const object = requireObject(world);
            const result = requestEditLock(world, {
              objectId: scenario.objectId,
              playerId: scenario.rivalId,
              baseVersion: object.version,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "submit_object_edit": {
            const object = requireObject(world);
            const editBuilder = scenario.refineSteps[0]?.builderSpec;
            if (!editBuilder) {
              throw new Error("selected scenario does not provide an edit builder fixture");
            }
            const result = submitObjectEdit(world, {
              objectId: scenario.objectId,
              playerId: scenario.rivalId,
              baseVersion: object.version,
              builderSpec: {
                ...editBuilder,
                base_object_version: object.version,
                target_object_id: scenario.objectId,
              },
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "cancel_edit": {
            const result = cancelEdit(world, {
              objectId: scenario.objectId,
              playerId: scenario.rivalId,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "expire_edit_lock": {
            const result = expireEditLock(world, {
              objectId: scenario.objectId,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          case "expire_cooldown": {
            const result = expireCooldown(world, {
              objectId: scenario.objectId,
            });
            world = result.world;
            lastMessage = result.event.message;
            break;
          }
          default:
            actionId satisfies never;
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
      }

      return this.getSnapshot();
    },
  };

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
}

function resolveAvailableActions(world: AuthorityWorld): LifecycleActionId[] {
  const object = getPrimaryObject(world);
  const pendingJob = world.jobs.some((job) => job.status === "pending");

  if (!pendingJob && !object) {
    return ["queue_create"];
  }

  if (pendingJob && !object) {
    return ["submit_ai_draft"];
  }

  if (!object) {
    return [];
  }

  switch (object.state) {
    case "grace":
      return ["nudge_draft", "scale_draft", "release_object", "expire_grace"];
    case "public":
      return ["request_edit_lock"];
    case "edit_locked":
      return ["submit_object_edit", "cancel_edit", "expire_edit_lock"];
    case "cooldown":
      return ["expire_cooldown"];
    default:
      return [];
  }
}

function requireObject(world: AuthorityWorld) {
  const object = getPrimaryObject(world);
  if (!object) {
    throw new Error("no authoritative object exists in the world");
  }
  return object;
}
