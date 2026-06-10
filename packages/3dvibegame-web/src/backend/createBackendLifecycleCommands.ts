import { PROMPT_VERSION } from "@3dvibegame/ai-planning";

import type {
  AiWorkerClient,
  AiWorkerFailureCode,
  GenerationActionId,
  ScenarioActionId,
} from "../core";
import {
  AiWorkerError,
  aiWorkerFailureLabel,
  canCopyObject,
  createObjectCopyTemplate,
  createFixtureAiWorkerClient,
  type ObjectCopyTemplate,
  type ObjectPastePoint,
  normalizeAiWorkerError,
  scenarios,
} from "../core";
import type {
  BackendPresenceBridge,
  BackendPresenceSnapshot,
  BackendUpdateWorldSettingsInput,
} from "./createBackendPresenceBridge";
import {
  backendAvailableActions,
  localBackendPlayerId,
  selectBackendObject,
} from "./createBackendGenerationSnapshot";
import { clampAvatarScale } from "../scene/avatar/avatarSpec";

export interface BackendLifecycleCommands {
  canHandle(): boolean;
  submitPrompt(prompt: string): Promise<void>;
  /**
   * Generate (or re-create) the local player's voxel avatar body from a prompt and
   * persist it via set_avatar_spec. First prompt builds from scratch; later prompts
   * feed the current avatar voxel core + change request, mirroring object edit.
   */
  editAvatar(prompt: string): Promise<void>;
  dispatchAction(actionId: GenerationActionId): Promise<void>;
  editSelectedObject(prompt: string): Promise<void>;
  lockSelectedObject(): Promise<void>;
  releaseSelectedLock(): Promise<void>;
  moveSelectedObject(dx: number, dy: number, dz: number): Promise<void>;
  deleteSelectedObject(): Promise<void>;
  canCopySelectedObject(): boolean;
  copySelectedObject(): ObjectCopyTemplate;
  releaseSelectedObjectForPaste(): Promise<void>;
  pasteCopiedObject(
    template: ObjectCopyTemplate,
    pastePoint: ObjectPastePoint,
  ): Promise<string>;
  updateWorldSettings(input: BackendUpdateWorldSettingsInput): Promise<void>;
  createSnapshot(reason?: string): Promise<void>;
  resetWorld(reason?: string): Promise<void>;
}

// A create/edit the local player just performed and has not yet rated. Carries the
// snapshot the FeedbackCard needs to submit a 👍/👎 without re-deriving anything.
export interface PendingObjectFeedback {
  operationId: string;
  objectId: string;
  objectVersion: number;
  operation: "create" | "edit";
  sourcePrompt: string;
  sourceSpecJson: string;
  builderSpecJson: string;
  modelId: string;
  promptVersion: string;
}

export interface BackendLifecycleCommandsOptions {
  getSelectedObjectId?: () => string | null;
  getSpawnPoint?: () => { x: number; y: number; z: number };
  /** Fired after a successful create/edit so the HUD can offer a feedback rating. */
  onOperation?: (feedback: PendingObjectFeedback) => void;
}

const MAX_MULTI_OBJECT_COUNT = 4;
const MULTI_SPAWN_SPACING = 2.5; // world units between copies

export function createBackendLifecycleCommands(
  bridge: BackendPresenceBridge,
  aiWorker: AiWorkerClient = createFixtureAiWorkerClient(),
  { getSelectedObjectId, getSpawnPoint, onOperation }: BackendLifecycleCommandsOptions = {},
): BackendLifecycleCommands {
  let sequence = 0;
  const selectedObjectId = () => getSelectedObjectId?.() ?? null;
  const spawnPoint = () => getSpawnPoint?.() ?? { x: 0, y: 0, z: 0 };

  // WASD fires many moves per second. Running the edit-lock sequence for each in
  // parallel races (one move's cancelEdit lands after another's lock), producing
  // "expected edit_locked but got public". So we serialize moves and coalesce any
  // that arrive while one is in flight into a single summed delta.
  let movePending: { dx: number; dy: number; dz: number } | null = null;
  let moveRunning = false;

  async function drainMoves() {
    if (moveRunning) return;
    moveRunning = true;
    try {
      while (movePending) {
        const { dx, dy, dz } = movePending;
        movePending = null;
        await performMove(dx, dy, dz);
      }
    } finally {
      moveRunning = false;
    }
  }

  async function performMove(dx: number, dy: number, dz: number) {
    const snapshot = bridge.getSnapshot();
    const object = selectBackendObject(snapshot, selectedObjectId());
    if (!object) {
      console.warn("[backend.move] no selected object");
      throw new Error("Select an object before moving it.");
    }

    const [px, py, pz] = object.transform.position;
    const [rx, ry, rz] = object.transform.rotation;
    const [sx, sy, sz] = object.transform.scale;
    const newY = Math.min(4.0, Math.max(-1.0, py + dy));
    const transform = {
      positionX: px + dx,
      positionY: newY,
      positionZ: pz + dz,
      rotationX: rx,
      rotationY: ry,
      rotationZ: rz,
      scaleX: sx,
      scaleY: sy,
      scaleZ: sz,
    };
    console.log(
      "[backend.move] start id=%s state=%s version=%s dx=%s dy=%s dz=%s",
      object.object_id,
      object.state,
      object.version,
      dx.toFixed(2),
      dy.toFixed(2),
      dz.toFixed(2),
    );

    // Branch on the object's ACTUAL current state each time.
    if (object.state === "grace") {
      console.log("[backend.move] grace -> updateDraftTransform");
      await bridge.updateDraftTransform({ objectId: object.object_id, ...transform });
      return;
    }

    if (object.state === "edit_locked") {
      // Already locked (e.g. we are holding it) — just move, don't re-lock/cancel.
      console.log("[backend.move] edit_locked -> updateLockedTransform");
      await bridge.updateLockedTransform({ objectId: object.object_id, ...transform });
      return;
    }

    if (object.state === "public") {
      // Acquire and HOLD the lock (released on deselect/Done/expiry) so the object
      // stays exclusively ours between moves instead of being free for other players.
      console.log("[backend.move] public -> requestEditLock (hold)");
      await bridge.requestEditLock({
        objectId: object.object_id,
        baseVersion: object.version,
      });
      console.log("[backend.move] public -> updateLockedTransform");
      await bridge.updateLockedTransform({ objectId: object.object_id, ...transform });
      console.log("[backend.move] public -> done (lock held)");
      return;
    }

    console.warn("[backend.move] not movable in state %s", object.state);
    throw new Error(`Object is in ${object.state} state and cannot be moved.`);
  }

  return {
    canHandle() {
      return isBackendReady(bridge);
    },
    updateWorldSettings(input) {
      if (!isBackendReady(bridge)) {
        throw new Error("Backend room is not ready yet.");
      }

      return bridge.updateWorldSettings(input);
    },
    createSnapshot(reason = "manual_reset") {
      if (!isBackendReady(bridge)) {
        throw new Error("Backend room is not ready yet.");
      }

      return bridge.createSnapshot({
        snapshotId: nextSnapshotId("snapshot", sequence++),
        reason,
      });
    },
    resetWorld(reason = "manual_reset") {
      if (!isBackendReady(bridge)) {
        throw new Error("Backend room is not ready yet.");
      }

      return bridge.resetWorld({
        snapshotId: nextSnapshotId("reset", sequence++),
        reason,
      });
    },
    async submitPrompt(prompt: string) {
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new Error("Type a message before sending it to Savi.");
      }

      // Call the AI once — it decides how many independent objects are needed.
      let draft: Awaited<ReturnType<AiWorkerClient["createDraft"]>>;
      try {
        draft = await aiWorker.createDraft({ prompt: trimmed });
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }

      const count = Math.min(draft.quantity, MAX_MULTI_OBJECT_COUNT);
      const baseSpawn = spawnPoint();

      // Register and submit one backend job per object, reusing the same spec.
      // Only the first object keeps its grace period so the player can position it;
      // the rest are released immediately and become click-selectable public objects.
      for (let i = 0; i < count; i++) {
        const idSuffix = `${Date.now().toString(36)}_${sequence++}`;
        const jobId = `backend_create_${idSuffix}`;
        const objectId = `${draft.objectIdBase}_${idSuffix}`;
        const spawn = {
          x: baseSpawn.x + i * MULTI_SPAWN_SPACING,
          y: baseSpawn.y,
          z: baseSpawn.z,
        };

        await bridge.requestCreateObject({ jobId, sourcePrompt: trimmed });
        try {
          await bridge.submitAiDraft({
            jobId,
            objectId,
            sourceSpecJson: draft.sourceSpecJson,
            builderSpecJson: draft.builderSpecJson,
            positionX: spawn.x,
            positionY: spawn.y,
            positionZ: spawn.z,
          });
        } catch (error) {
          await failCreateJob(bridge, jobId, "validation_failed");
          throw error;
        }

        // Release extra copies immediately — player interacts with the first one
        // via the normal grace flow, then clicks each subsequent object to move it.
        if (i > 0) {
          await bridge.releaseObject({ objectId }).catch(() => {});
        } else {
          // Offer feedback on the first object only — one rating per prompt. The
          // job_id is the create operation's dedupe key (see object-feedback plan).
          onOperation?.({
            operationId: jobId,
            objectId,
            objectVersion: 1,
            operation: "create",
            sourcePrompt: trimmed,
            sourceSpecJson: draft.sourceSpecJson,
            builderSpecJson: draft.builderSpecJson,
            modelId: draft.modelId,
            promptVersion: PROMPT_VERSION,
          });
        }
      }
    },
    async editAvatar(prompt: string) {
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new Error("Describe the avatar you want.");
      }
      if (!isBackendReady(bridge)) {
        throw new Error("Backend room is not ready yet.");
      }

      const snapshot = bridge.getSnapshot();
      const localPlayerId = localBackendPlayerId(snapshot);
      const currentAvatar = snapshot.avatars.find(
        (avatar) => avatar.id === localPlayerId,
      );

      let artifact: Awaited<ReturnType<AiWorkerClient["createDraft"]>> | Awaited<
        ReturnType<AiWorkerClient["createEdit"]>
      >;
      try {
        if (currentAvatar) {
          // Re-create from the existing body + change request, like object edit.
          artifact = await aiWorker.createEdit({
            baseObjectId: "player_avatar",
            baseVersion: currentAvatar.version,
            sourcePrompt: trimmed,
            purpose: "avatar",
            objectContext: {
              objectId: "player_avatar",
              version: currentAvatar.version,
              sourceSpecJson: currentAvatar.voxelCoreJson,
              builderSpecJson: currentAvatar.builderSpecJson,
            },
          });
        } else {
          // First-ever avatar: generate from scratch.
          artifact = await aiWorker.createDraft({ prompt: trimmed, purpose: "avatar" });
        }
      } catch (error) {
        throw userFacingAiWorkerError(error);
      }

      // AI omitting scale means "the request said nothing about size" — keep the
      // player's current scale (or human size for a first body).
      const scale = clampAvatarScale(
        artifact.avatarScale ?? currentAvatar?.scale ?? 1,
      );
      await bridge.setAvatarSpec({
        voxelCoreJson: artifact.sourceSpecJson,
        builderSpecJson: artifact.builderSpecJson,
        scale,
      });
    },
    async dispatchAction(actionId: GenerationActionId) {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      const allowedActions = backendAvailableActions(snapshot, object);

      if (!object || !allowedActions.includes(actionId)) {
        throw new Error("That backend object action is not available right now.");
      }

      if (isTransformAction(actionId)) {
        const transform = transformForAction(actionId, object.transform, object.builder_spec.parts);
        if (object.state === "grace") {
          await bridge.updateDraftTransform({
            objectId: object.object_id,
            ...transform,
          });
          return;
        }

        // Public objects can only be mutated under an edit lock. Apply the
        // transform in place and immediately cancel the lock so the move/rotate
        // persists without bumping the object version or starting a cooldown.
        if (object.state === "public") {
          await bridge.requestEditLock({
            objectId: object.object_id,
            baseVersion: object.version,
          });
        }
        await bridge.updateLockedTransform({
          objectId: object.object_id,
          ...transform,
        });
        await bridge.cancelEdit({ objectId: object.object_id });
        return;
      }

      if (actionId === "release_object") {
        if (object.state === "grace") {
          await bridge.releaseObject({ objectId: object.object_id });
          return;
        }

        if (object.state === "edit_locked") {
          await bridge.cancelEdit({ objectId: object.object_id });
          return;
        }
      }

      if (!isScenarioAction(actionId)) {
        throw new Error("Backend refine action is not supported by the AI worker.");
      }

      let edit: Awaited<ReturnType<AiWorkerClient["createEdit"]>>;
      try {
        edit = await aiWorker.createEdit({
          actionId,
          baseObjectId: object.object_id,
          baseVersion: object.version,
          sourcePrompt: sourcePromptForAction(actionId),
          objectContext: {
            objectId: object.object_id,
            version: object.version,
            sourceSpecJson: sourceSpecJsonForObject(snapshot, object.object_id),
            builderSpecJson: JSON.stringify(object.builder_spec),
          },
        });
      } catch (error) {
        throw userFacingAiWorkerError(error);
      }

      await bridge.requestEditLock({
        objectId: object.object_id,
        baseVersion: object.version,
      });
      await bridge.submitObjectEdit({
        objectId: object.object_id,
        baseVersion: object.version,
        sourceSpecJson: edit.sourceSpecJson,
        builderSpecJson: edit.builderSpecJson,
      });
      await bridge.expireCooldown({ objectId: object.object_id });
    },
    // Free-form AI edit of the selected object: feed the LLM the current spec + the
    // player's change request, then submit the result as a new object version.
    async editSelectedObject(prompt: string) {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) {
        throw new Error("Select an object to edit it.");
      }

      const localPlayerId = localBackendPlayerId(snapshot);
      // The creator can edit their fresh draft while it's still in grace (before
      // releasing it). The backend has no grace-edit path, so we release it to the
      // world first (below) and run the normal public edit flow.
      const isOwnedGrace =
        object.state === "grace" && object.grace_owner_id === localPlayerId;
      if (object.state === "edit_locked" && object.lock_owner_id !== localPlayerId) {
        throw new Error("Object is being edited by another player.");
      }
      if (object.state === "grace" && !isOwnedGrace) {
        throw new Error("Object is in another player's grace window.");
      }
      if (
        object.state !== "public" &&
        object.state !== "edit_locked" &&
        !isOwnedGrace
      ) {
        throw new Error(`Object cannot be edited in ${object.state} state.`);
      }

      let edit: Awaited<ReturnType<AiWorkerClient["createEdit"]>>;
      try {
        edit = await aiWorker.createEdit({
          baseObjectId: object.object_id,
          baseVersion: object.version,
          sourcePrompt: prompt,
          objectContext: {
            objectId: object.object_id,
            version: object.version,
            sourceSpecJson: sourceSpecJsonForObject(snapshot, object.object_id),
            builderSpecJson: JSON.stringify(object.builder_spec),
          },
        });
      } catch (error) {
        throw userFacingAiWorkerError(error);
      }

      // A grace draft can't be edit-locked directly (request_edit_lock requires the
      // object to be `public`), so release it to the world first. The owner keeps
      // exclusive control by immediately acquiring the edit lock below.
      if (isOwnedGrace) {
        await bridge.releaseObject({ objectId: object.object_id });
      }
      // Public (and just-released grace) objects need a lock first; if we already hold
      // it (e.g. from selection), skip.
      if (object.state === "public" || isOwnedGrace) {
        await bridge.requestEditLock({
          objectId: object.object_id,
          baseVersion: object.version,
        });
      }
      await bridge.submitObjectEdit({
        objectId: object.object_id,
        baseVersion: object.version,
        sourceSpecJson: edit.sourceSpecJson,
        builderSpecJson: edit.builderSpecJson,
      });
      await bridge.expireCooldown({ objectId: object.object_id });

      // Edits don't create an ai_job, so mint an op id here as the feedback dedupe key.
      // submitObjectEdit bumps the version, so the rated version is base + 1.
      onOperation?.({
        operationId: `backend_edit_${Date.now().toString(36)}_${sequence++}`,
        objectId: object.object_id,
        objectVersion: object.version + 1,
        operation: "edit",
        sourcePrompt: prompt,
        sourceSpecJson: edit.sourceSpecJson,
        builderSpecJson: edit.builderSpecJson,
        modelId: edit.modelId,
        promptVersion: PROMPT_VERSION,
      });
    },
    // Acquire an exclusive edit lock on the selected object so other players can't
    // move it. Public objects get locked (held until release); grace drafts are
    // already exclusive to their owner. Throws if another player holds it.
    async lockSelectedObject() {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) return;

      const localPlayerId = localBackendPlayerId(snapshot);
      if (object.state === "edit_locked" && object.lock_owner_id !== localPlayerId) {
        throw new Error("Object is locked by another player.");
      }
      if (object.state === "grace" && object.grace_owner_id !== localPlayerId) {
        throw new Error("Object is in another player's grace window.");
      }
      // grace(mine) / edit_locked(mine) are already exclusive — only public needs a lock.
      if (object.state !== "public") return;

      console.log("[backend.lock] requestEditLock id=%s version=%s", object.object_id, object.version);
      await bridge.requestEditLock({
        objectId: object.object_id,
        baseVersion: object.version,
      });
    },

    // Release the edit lock we hold on the selected object (on deselect / Done /
    // 30s expiry). Reads the selection synchronously before any await so the caller
    // can clear it immediately after.
    async releaseSelectedLock() {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) return;
      const localPlayerId = localBackendPlayerId(snapshot);
      if (object.state === "edit_locked" && object.lock_owner_id === localPlayerId) {
        console.log("[backend.lock] cancelEdit id=%s", object.object_id);
        await bridge.cancelEdit({ objectId: object.object_id });
      }
    },

    async moveSelectedObject(dx: number, dy: number, dz: number) {
      movePending = movePending
        ? { dx: movePending.dx + dx, dy: movePending.dy + dy, dz: movePending.dz + dz }
        : { dx, dy, dz };
      await drainMoves();
    },
    async deleteSelectedObject() {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) {
        throw new Error("Select an object before deleting it.");
      }

      // delete_object only accepts `public`, so first bring the object there:
      //  - grace draft (ours): release it (grace -> public)
      //  - edit_locked (ours, e.g. from selection): cancel the lock (-> public)
      const localPlayerId = localBackendPlayerId(snapshot);
      if (object.state === "grace") {
        if (object.grace_owner_id !== localPlayerId) {
          throw new Error("Only the creator can discard this draft.");
        }
        await bridge.releaseObject({ objectId: object.object_id });
      } else if (object.state === "edit_locked" && object.lock_owner_id === localPlayerId) {
        await bridge.cancelEdit({ objectId: object.object_id });
      }

      await bridge.deleteObject({ objectId: object.object_id });
    },
    canCopySelectedObject() {
      const snapshot = bridge.getSnapshot();
      return canCopyObject(
        selectBackendObject(snapshot, selectedObjectId()),
        localBackendPlayerId(snapshot),
      );
    },
    copySelectedObject() {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) {
        throw new Error("Select an object before copying it.");
      }
      const artifact = snapshot.objectArtifacts.find(
        (candidate) => candidate.objectId === object.object_id,
      );
      if (!artifact?.sourceSpecJson) {
        throw new Error("This object is missing its source spec and cannot be copied.");
      }
      return createObjectCopyTemplate({
        object,
        localPlayerId: localBackendPlayerId(snapshot),
        sourceSpecJson: artifact.sourceSpecJson,
        builderSpecJson: artifact.builderSpecJson,
      });
    },
    async releaseSelectedObjectForPaste() {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot, selectedObjectId());
      if (!object) return;

      const localPlayerId = localBackendPlayerId(snapshot);
      if (object.state === "grace" && object.grace_owner_id === localPlayerId) {
        await bridge.releaseObject({ objectId: object.object_id });
        return;
      }
      if (object.state === "edit_locked" && object.lock_owner_id === localPlayerId) {
        await bridge.cancelEdit({ objectId: object.object_id });
      }
    },
    async pasteCopiedObject(template, pastePoint) {
      if (!isBackendReady(bridge)) {
        throw new Error("Backend room is not ready yet.");
      }
      if (!template.sourceSpecJson) {
        throw new Error("Copied object is missing its source spec.");
      }

      const idSuffix = `${Date.now().toString(36)}_${sequence++}`;
      const jobId = `backend_duplicate_${idSuffix}`;
      const objectId = `${slug(template.category)}_copy_${idSuffix}`;

      await bridge.requestCreateObject({
        jobId,
        sourcePrompt: `duplicate ${template.category}`,
      });
      try {
        await bridge.submitAiDraft({
          jobId,
          objectId,
          sourceSpecJson: template.sourceSpecJson,
          builderSpecJson: template.builderSpecJson,
          positionX: pastePoint.x,
          positionY: pastePoint.y,
          positionZ: pastePoint.z,
        });
      } catch (error) {
        await failCreateJob(bridge, jobId, "validation_failed");
        throw error;
      }

      const [rotationX, rotationY, rotationZ] = template.transform.rotation;
      const [scaleX, scaleY, scaleZ] = template.transform.scale;
      await bridge.updateDraftTransform({
        objectId,
        positionX: pastePoint.x,
        positionY: pastePoint.y,
        positionZ: pastePoint.z,
        rotationX,
        rotationY,
        rotationZ,
        scaleX,
        scaleY,
        scaleZ,
      });

      return objectId;
    },
  };
}

function nextSnapshotId(prefix: string, sequence: number) {
  return `${prefix}_${Date.now().toString(36)}_${sequence}`;
}

async function failCreateJobForWorkerError(
  bridge: BackendPresenceBridge,
  jobId: string,
  error: unknown,
) {
  const normalized = normalizeAiWorkerError(error);
  await failCreateJob(bridge, jobId, normalized.code);
  return userFacingAiWorkerError(normalized);
}

async function failCreateJob(
  bridge: BackendPresenceBridge,
  jobId: string,
  errorCode: AiWorkerFailureCode,
) {
  try {
    if (errorCode === "timeout") {
      await bridge.expireAiJob({ jobId });
      return;
    }

    await bridge.failAiJob({ jobId, errorCode });
  } catch {
    // The original worker or draft-submit failure is more useful to the caller.
  }
}

function userFacingAiWorkerError(error: unknown) {
  const normalized = normalizeAiWorkerError(error);
  const label = aiWorkerFailureLabel(normalized.code);
  const message =
    normalized.message === label || normalized.message.startsWith(label)
      ? normalized.message
      : `${label} ${normalized.message}`;
  return new AiWorkerError(normalized.code, message);
}

function sourcePromptForAction(actionId: ScenarioActionId) {
  return (
    scenarios.avatar_forge.refineSteps.find((step) => step.actionId === actionId)
      ?.description ?? actionId
  );
}

function sourceSpecJsonForObject(snapshot: BackendPresenceSnapshot, objectId: string) {
  return snapshot.objectArtifacts.find((artifact) => artifact.objectId === objectId)
    ?.sourceSpecJson;
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

function isScenarioAction(actionId: GenerationActionId): actionId is ScenarioActionId {
  return actionId === "refine_silhouette" || actionId === "add_ornament";
}

function isBackendReady(bridge: BackendPresenceBridge) {
  const snapshot = bridge.getSnapshot();
  return (
    snapshot.enabled &&
    snapshot.status === "connected" &&
    !!snapshot.world &&
    !!localBackendPlayerId(snapshot)
  );
}

function isTransformAction(
  actionId: GenerationActionId,
): actionId is "nudge_draft" | "rotate_draft" | "scale_draft" | "scale_down_draft" {
  return (
    actionId === "nudge_draft" ||
    actionId === "rotate_draft" ||
    actionId === "scale_draft" ||
    actionId === "scale_down_draft"
  );
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

function transformForAction(
  actionId: "nudge_draft" | "rotate_draft" | "scale_draft" | "scale_down_draft",
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  },
  parts: { local_position?: [number, number, number]; dimensions: [number, number, number] }[],
) {
  const [positionX, positionY, positionZ] = transform.position;
  const [rotationX, rotationY, rotationZ] = transform.rotation;
  const [scaleX, scaleY, scaleZ] = transform.scale;

  switch (actionId) {
    case "nudge_draft":
      return {
        positionX: positionX + 0.45,
        positionY,
        positionZ: positionZ - 0.3,
        rotationX,
        rotationY,
        rotationZ,
        scaleX,
        scaleY,
        scaleZ,
      };
    case "rotate_draft":
      return {
        positionX,
        positionY,
        positionZ,
        rotationX,
        rotationY: rotationY + Math.PI / 8,
        rotationZ,
        scaleX,
        scaleY,
        scaleZ,
      };
    case "scale_draft": {
      const factor = 1.12;
      const bottomLocal = computeBottomLocal(parts);
      return {
        positionX,
        positionY: positionY + bottomLocal * scaleY * (1 - factor),
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scaleX: scaleX * factor,
        scaleY: scaleY * factor,
        scaleZ: scaleZ * factor,
      };
    }
    case "scale_down_draft": {
      const factor = 1 / 1.12;
      const bottomLocal = computeBottomLocal(parts);
      return {
        positionX,
        positionY: positionY + bottomLocal * scaleY * (1 - factor),
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scaleX: scaleX * factor,
        scaleY: scaleY * factor,
        scaleZ: scaleZ * factor,
      };
    }
    default:
      actionId satisfies never;
      return {
        positionX,
        positionY,
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scaleX,
        scaleY,
        scaleZ,
      };
  }
}
