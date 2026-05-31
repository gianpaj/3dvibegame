import type { GenerationActionId } from "../core";
import { resolveScenarioFromPrompt, scenarios } from "../core";
import type { BackendPresenceBridge } from "./createBackendPresenceBridge";
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

      const scenario = resolveScenarioFromPrompt(trimmed);
      const idSuffix = `${Date.now().toString(36)}_${sequence++}`;
      const jobId = `${scenario.jobId}_${idSuffix}`;
      const objectId = `${scenario.objectId}_${idSuffix}`;

      await bridge.requestCreateObject({
        jobId,
        sourcePrompt: trimmed,
      });
      await bridge.submitAiDraft({
        jobId,
        objectId,
        sourceSpecJson: JSON.stringify(scenario.voxelSource),
        builderSpecJson: JSON.stringify(scenario.draftBuilder),
      });
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

      const refineStep = scenarios.avatar_forge.refineSteps.find(
        (step) => step.actionId === actionId,
      );
      if (!refineStep) {
        throw new Error("Backend refine recipe not found.");
      }

      await bridge.requestEditLock({
        objectId: object.object_id,
        baseVersion: object.version,
      });
      await bridge.submitObjectEdit({
        objectId: object.object_id,
        baseVersion: object.version,
        sourceSpecJson: JSON.stringify(refineStep.voxelSource),
        builderSpecJson: JSON.stringify(refineStep.builderSpec),
      });
      await bridge.expireCooldown({ objectId: object.object_id });
    },
  };
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
