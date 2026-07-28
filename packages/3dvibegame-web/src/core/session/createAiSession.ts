import {
  createAuthorityWorld,
  deleteObject,
  discardDraft,
  expireCooldown,
  releaseEditLock,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  updateDraftTransform,
  updateLockedTransform,
  type AuthorityWorld,
  type GenerationStage,
  type GenerationStageEvent,
} from "@3dvibegame/scene-authority-ts";

import type { AiWorkerClient, AiWorkerDraftResult } from "../aiWorker/fixtureAiWorkerClient";
import {
  canCopyObject,
  cloneBuilderSpec,
  createObjectCopyTemplate,
  type ObjectCopyTemplate,
  type ObjectPastePoint,
} from "../objectClipboard";
import type { GenerationActionId } from "./generationSession";
import type { SceneDocument, SceneObjectRecord, PlayerSessionState } from "../state/contracts";

export interface AiSessionSnapshot {
  document: SceneDocument;
  world: AuthorityWorld;
  stage: GenerationStage;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  object: AuthorityWorld["objects"][number] | null;
  availableActions: GenerationActionId[];
}

export function createAiSession(aiClient: AiWorkerClient) {
  const playerId = "player_1";
  let world = createInitialWorld();
  let stage: GenerationStage = "idle";
  let lastMessage = "Type a prompt to generate an object with Gemini.";
  let activeObjectId: string | null = null;
  let requestCounter = 0;
  let stageEvents: GenerationStageEvent[] = [];
  let eventSequence = 0;
  let lastRecordedMessage = "";
  const listeners = new Set<() => void>();

  // Capture each distinct status message as a stage event so the chat panel can
  // replay the session's progress. Hooked into notify() so every state change is seen.
  function recordEvent() {
    if (lastMessage === lastRecordedMessage) return;
    lastRecordedMessage = lastMessage;
    eventSequence += 1;
    const status: GenerationStageEvent["status"] = stage === "failed" ? "error" : "complete";
    stageEvents = [
      ...stageEvents,
      {
        id: `ai_event_${eventSequence}`,
        stage,
        message: lastMessage,
        status,
        timestamp: new Date().toISOString(),
      },
    ].slice(-32);
  }

  function notify() {
    recordEvent();
    listeners.forEach((fn) => fn());
  }

  function currentObject() {
    return activeObjectId
      ? (world.objects.find((o) => o.object_id === activeObjectId) ?? null)
      : null;
  }

  function resolveAvailableActions(
    object: AuthorityWorld["objects"][number] | null,
  ): GenerationActionId[] {
    if (!object) return [];
    if (object.state === "grace") {
      return [
        "nudge_draft",
        "rotate_draft",
        "scale_draft",
        "scale_down_draft",
        "release_object",
      ];
    }
    if (object.state === "edit_locked") {
      return [
        "nudge_draft",
        "rotate_draft",
        "scale_draft",
        "scale_down_draft",
        "release_object",
      ];
    }
    if (object.state === "public") {
      return [
        "nudge_draft",
        "rotate_draft",
        "scale_draft",
        "scale_down_draft",
        "release_object",
      ];
    }
    return [];
  }

  function buildDocument(): SceneDocument {
    const records: Record<string, SceneObjectRecord> = {};
    const rootIds: string[] = [];
    for (const obj of world.objects) {
      if (obj.state !== "deleted") {
        records[obj.object_id] = {
          object_id: obj.object_id,
          authority: obj,
          voxel_artifact: null,
          compiled_artifact: null,
          diagnostics: [],
        };
        rootIds.push(obj.object_id);
      }
    }
    const session: PlayerSessionState = {
      player_id: playerId,
      selection: { selected_object_id: activeObjectId },
      generation_session: null,
      tool_state: { active_tool: "prompt_create" },
      history: { entries: [], active_batch_id: null },
      camera_dirty: false,
      focus_target_object_id: activeObjectId,
    };
    return {
      objects_by_id: records,
      root_object_ids: rootIds,
      shared_dirty: {
        source_dirty_ids: [],
        artifact_dirty_ids: [],
        render_dirty_ids: rootIds,
      },
      player_sessions_by_id: { [playerId]: session },
    };
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): AiSessionSnapshot {
      const object = currentObject();
      return {
        document: buildDocument(),
        world,
        stage,
        lastMessage,
        stageEvents,
        object,
        availableActions: resolveAvailableActions(object),
      };
    },

    async submitPrompt(prompt: string) {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      // Block while actively generating
      if (stage === "queued" || stage === "planning" || stage === "compiled_artifact_ready") return;

      const n = ++requestCounter;
      activeObjectId = null;
      stage = "queued";
      lastMessage = "Queued — sending to Gemini…";
      notify();

      // Brief tick so React renders the queued state before the async call
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      stage = "planning";
      lastMessage = "Gemini is generating your object…";
      notify();

      let draft: AiWorkerDraftResult;
      try {
        draft = await aiClient.createDraft({ prompt: trimmed });
      } catch (error) {
        if (n !== requestCounter) return;
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : "Gemini generation failed.";
        notify();
        return;
      }

      if (n !== requestCounter) return;

      stage = "compiled_artifact_ready";
      lastMessage = "Building 3D model from AI spec…";
      notify();

      const jobId = `ai_job_${n}`;
      const objectId = `${draft.objectIdBase}_${n}`;

      try {
        const queued = requestCreateObject(world, {
          jobId,
          playerId,
          sourcePrompt: trimmed,
        });
        world = queued.world;

        const drafted = submitAIDraft(world, {
          jobId,
          objectId,
          creatorId: playerId,
          builderSpec: draft.builderSpec,
          graceSeconds: 30,
        });
        world = drafted.world;
        activeObjectId = objectId;
        stage = "grace";
        lastMessage = "Object ready! Move, rotate, scale, then release.";
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : "Failed to create object.";
      }
      notify();
    },

    dispatch(actionId: GenerationActionId) {
      const object = currentObject();
      console.log("[dispatch] actionId=%s object=%s objectState=%s stage=%s", actionId, object?.object_id ?? "null", object?.state ?? "null", stage);
      if (!object) {
        lastMessage = "Select an object first.";
        notify();
        return;
      }

      try {
        switch (actionId) {
          case "release_object": {
            if (object.state === "public") {
              // Already in the world — just deselect
              activeObjectId = null;
              stage = "idle";
              lastMessage = "Deselected.";
              console.log("[dispatch] release_object (public deselect) done");
              break;
            }
            if (object.state === "grace" || object.state === "edit_locked") {
              const released = releaseObject(world, { objectId: object.object_id, playerId });
              world = released.world;
              // With object_cooldown_seconds: 0 the object skips cooldown and is already
              // "public" after releaseObject — only call expireCooldown when needed.
              const afterRelease = world.objects.find((o) => o.object_id === object.object_id);
              if (afterRelease?.state === "cooldown") {
                world = expireCooldown(world, { objectId: object.object_id }).world;
              }
            }
            activeObjectId = null;
            stage = "idle";
            lastMessage = "Object released to the world!";
            console.log("[dispatch] release_object done — stage=%s activeObjectId=%s", stage, activeObjectId);
            break;
          }
          case "nudge_draft": {
            const [px, , pz] = object.transform.position;
            const patch = { position: { x: px + 0.45, z: pz - 0.3 } };
            world = applyTransform(world, object, playerId, patch);
            lastMessage = "Object moved.";
            break;
          }
          case "rotate_draft": {
            const [, ry] = object.transform.rotation;
            const patch = { rotation: { y: ry + Math.PI / 8 } };
            world = applyTransform(world, object, playerId, patch);
            lastMessage = "Object rotated.";
            break;
          }
          case "scale_draft": {
            const [sx, sy, sz] = object.transform.scale;
            const [, py] = object.transform.position;
            const factor = 1.12;
            const bottomLocal = computeBottomLocal(object.builder_spec.parts);
            const patch = {
              scale: { x: sx * factor, y: sy * factor, z: sz * factor },
              position: { y: py + bottomLocal * sy * (1 - factor) },
            };
            world = applyTransform(world, object, playerId, patch);
            lastMessage = "Object scaled up.";
            break;
          }
          case "scale_down_draft": {
            const [sx, sy, sz] = object.transform.scale;
            const [, py] = object.transform.position;
            const factor = 1 / 1.12;
            const bottomLocal = computeBottomLocal(object.builder_spec.parts);
            const patch = {
              scale: { x: sx * factor, y: sy * factor, z: sz * factor },
              position: { y: py + bottomLocal * sy * (1 - factor) },
            };
            world = applyTransform(world, object, playerId, patch);
            lastMessage = "Object scaled down.";
            break;
          }
          default:
            lastMessage = "Action not supported.";
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Action failed.";
      }
      notify();
    },

    moveSelected(dx: number, dy: number, dz: number) {
      const object = currentObject();
      if (!object) return;
      try {
        const [px, py, pz] = object.transform.position;
        const newY = Math.min(4.0, Math.max(-1.0, py + dy));
        const patch = { position: { x: px + dx, y: newY, z: pz + dz } };
        world = applyTransform(world, object, playerId, patch);
        lastMessage = "Object moved.";
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Move failed.";
      }
      notify();
    },

    deleteSelected() {
      const object = currentObject();
      if (!object) return;
      try {
        if (object.state === "grace") {
          world = discardDraft(world, { objectId: object.object_id, playerId }).world;
        } else {
          if (object.state === "edit_locked") {
            world = releaseEditLock(world, { objectId: object.object_id, playerId }).world;
          }
          world = deleteObject(world, { objectId: object.object_id, playerId }).world;
        }
        activeObjectId = null;
        const hasObjects = world.objects.some((o) => o.state !== "deleted");
        stage = hasObjects ? "released" : "idle";
        lastMessage = "Object deleted.";
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Delete failed.";
      }
      notify();
    },

    canCopySelectedObject() {
      return canCopyObject(currentObject(), playerId);
    },

    copySelectedObject(): ObjectCopyTemplate {
      const object = currentObject();
      if (!object) {
        throw new Error("Select an object before copying it.");
      }
      return createObjectCopyTemplate({ object, localPlayerId: playerId });
    },

    releaseSelectedObjectForPaste() {
      const object = currentObject();
      if (!object) return;
      try {
        if (object.state === "grace") {
          world = releaseObject(world, { objectId: object.object_id, playerId }).world;
        } else if (object.state === "edit_locked") {
          world = releaseEditLock(world, { objectId: object.object_id, playerId }).world;
        }
        activeObjectId = null;
      } catch (error) {
        lastMessage =
          error instanceof Error ? error.message : "Failed to release selected object.";
        notify();
        throw error;
      }
      notify();
    },

    async pasteCopiedObject(
      template: ObjectCopyTemplate,
      pastePoint: ObjectPastePoint,
    ) {
      const n = ++requestCounter;
      const jobId = `local_duplicate_${n}`;
      const objectId = `${slug(template.category)}_copy_${n}`;

      try {
        world = requestCreateObject(world, {
          jobId,
          playerId,
          sourcePrompt: `duplicate ${template.category}`,
        }).world;
        world = submitAIDraft(world, {
          jobId,
          objectId,
          creatorId: playerId,
          builderSpec: cloneBuilderSpec(template.builderSpec),
          graceSeconds: 30,
        }).world;
        const [rotationX, rotationY, rotationZ] = template.transform.rotation;
        const [scaleX, scaleY, scaleZ] = template.transform.scale;
        world = updateDraftTransform(world, {
          objectId,
          playerId,
          patch: {
            position: { x: pastePoint.x, y: pastePoint.y, z: pastePoint.z },
            rotation: { x: rotationX, y: rotationY, z: rotationZ },
            scale: { x: scaleX, y: scaleY, z: scaleZ },
          },
        }).world;
        activeObjectId = objectId;
        stage = "grace";
        lastMessage = `Duplicated ${template.category}. Move, rotate, scale, then release.`;
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : "Duplicate failed.";
        notify();
        throw error;
      }

      notify();
      return objectId;
    },

    selectObject(objectId: string | null) {
      const obj = objectId
        ? (world.objects.find((o) => o.object_id === objectId) ?? null)
        : null;
      activeObjectId = objectId;

      if (obj) {
        if (obj.state === "grace") {
          stage = "grace";
          lastMessage = `Reviewing ${obj.builder_spec.object_category}. Release when ready.`;
        } else if (obj.state === "edit_locked") {
          stage = "edit_locked";
          lastMessage = `Editing ${obj.builder_spec.object_category}.`;
        } else {
          stage = "released";
          lastMessage = `Selected ${obj.builder_spec.object_category}. Move, rotate, or scale it.`;
        }
      } else {
        const hasObjects = world.objects.some((o) => o.state !== "deleted");
        stage = hasObjects ? "released" : "idle";
        lastMessage = hasObjects
          ? "Click an object to select it."
          : "Type a prompt to generate an object.";
      }
      notify();
    },

    dispose() {
      listeners.clear();
    },
  };
}

function computeBottomLocal(
  parts: { local_position?: [number, number, number]; dimensions: [number, number, number] }[],
): number {
  let bottom = 0;
  for (const part of parts) {
    const localY = part.local_position ? part.local_position[1] : part.dimensions[1] / 2;
    bottom = Math.min(bottom, localY - part.dimensions[1] / 2);
  }
  return bottom;
}

function applyTransform(
  world: AuthorityWorld,
  object: AuthorityWorld["objects"][number],
  playerId: string,
  patch: {
    position?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number; y?: number; z?: number };
    scale?: { x?: number; y?: number; z?: number };
  },
): AuthorityWorld {
  if (object.state === "grace") {
    return updateDraftTransform(world, { objectId: object.object_id, playerId, patch }).world;
  }

  if (object.state === "edit_locked") {
    return updateLockedTransform(world, { objectId: object.object_id, playerId, patch }).world;
  }

  if (object.state === "public") {
    let w = requestEditLock(world, {
      objectId: object.object_id,
      playerId,
      baseVersion: object.version,
    }).world;
    w = updateLockedTransform(w, { objectId: object.object_id, playerId, patch }).world;
    // Release the edit lock with releaseEditLock (not releaseObject, which is grace-only)
    w = releaseEditLock(w, { objectId: object.object_id, playerId }).world;
    // With object_cooldown_seconds: 0 the object may skip cooldown; only expire if needed
    const afterRelease = w.objects.find((o) => o.object_id === object.object_id);
    if (afterRelease?.state === "cooldown") {
      w = expireCooldown(w, { objectId: object.object_id }).world;
    }
    return w;
  }

  return world;
}

function createInitialWorld(): AuthorityWorld {
  return createAuthorityWorld({
    worldId: "local_ai_world",
    settings: {
      visibility: "private",
      // Enable deletion in the single-player local world.
      destructive_edits_enabled: true,
      object_cooldown_seconds: 0,
      protected_spawn_enabled: false,
    },
  });
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "object"
  );
}
