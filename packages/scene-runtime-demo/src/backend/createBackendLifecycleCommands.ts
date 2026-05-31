import type {
  AiWorkerClient,
  AiWorkerFailureCode,
  GenerationActionId,
  ScenarioActionId,
} from "../core";
import {
  AiWorkerError,
  aiWorkerFailureLabel,
  createFixtureAiWorkerClient,
  normalizeAiWorkerError,
  scenarios,
} from "../core";
import type {
  BackendPresenceBridge,
  BackendPresenceSnapshot,
} from "./createBackendPresenceBridge";
import {
  backendAvailableActions,
  localBackendPlayerId,
  selectBackendObject,
} from "./createBackendGenerationSnapshot";

export interface BackendLifecycleCommands {
  canHandle(): boolean;
  submitPrompt(prompt: string): Promise<void>;
  dispatchAction(actionId: GenerationActionId): Promise<void>;
}

export function createBackendLifecycleCommands(
  bridge: BackendPresenceBridge,
  aiWorker: AiWorkerClient = createFixtureAiWorkerClient(),
): BackendLifecycleCommands {
  let sequence = 0;

  return {
    canHandle() {
      return isBackendReady(bridge);
    },
    async submitPrompt(prompt: string) {
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new Error("Type a message before sending it to Savi.");
      }

      const idSuffix = `${Date.now().toString(36)}_${sequence++}`;
      const jobId = `backend_create_${idSuffix}`;

      await bridge.requestCreateObject({
        jobId,
        sourcePrompt: trimmed,
      });

      let draft: Awaited<ReturnType<AiWorkerClient["createDraft"]>>;
      try {
        draft = await aiWorker.createDraft({ prompt: trimmed });
      } catch (error) {
        throw await failCreateJobForWorkerError(bridge, jobId, error);
      }

      const objectId = `${draft.objectIdBase}_${idSuffix}`;
      try {
        await bridge.submitAiDraft({
          jobId,
          objectId,
          sourceSpecJson: draft.sourceSpecJson,
          builderSpecJson: draft.builderSpecJson,
        });
      } catch (error) {
        await failCreateJob(bridge, jobId, "validation_failed");
        throw error;
      }
    },
    async dispatchAction(actionId: GenerationActionId) {
      const snapshot = bridge.getSnapshot();
      const object = selectBackendObject(snapshot);
      const allowedActions = backendAvailableActions(snapshot, object);

      if (!object || !allowedActions.includes(actionId)) {
        throw new Error("That backend object action is not available right now.");
      }

      if (isTransformAction(actionId)) {
        const transform = transformForAction(actionId, object.transform);
        if (object.state === "grace") {
          await bridge.updateDraftTransform({
            objectId: object.object_id,
            ...transform,
          });
          return;
        }

        if (object.state === "edit_locked") {
          await bridge.updateLockedTransform({
            objectId: object.object_id,
            ...transform,
          });
          return;
        }

        await bridge.requestEditLock({
          objectId: object.object_id,
          baseVersion: object.version,
        });
        await bridge.updateLockedTransform({
          objectId: object.object_id,
          ...transform,
        });
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
  };
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
): actionId is "nudge_draft" | "rotate_draft" | "scale_draft" {
  return (
    actionId === "nudge_draft" ||
    actionId === "rotate_draft" ||
    actionId === "scale_draft"
  );
}

function transformForAction(
  actionId: "nudge_draft" | "rotate_draft" | "scale_draft",
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  },
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
    case "scale_draft":
      return {
        positionX,
        positionY,
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scaleX: scaleX * 1.12,
        scaleY: scaleY * 1.12,
        scaleZ: scaleZ * 1.12,
      };
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
