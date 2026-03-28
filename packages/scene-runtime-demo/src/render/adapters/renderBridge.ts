import type { ObjectIntent } from "@3dvibegame/scene-runtime-ts";
import * as THREE from "three";

import type { PipelineSnapshot } from "../../runtime/pipeline";
import { createDraftObject } from "../objects/createDraftObject";

interface RenderBridgeConfig {
  draftRoot: THREE.Group;
  anchors: Map<string, THREE.Vector3>;
  defaultFocus: THREE.Vector3;
}

export function createRenderBridge({
  draftRoot,
  anchors,
  defaultFocus,
}: RenderBridgeConfig) {
  return {
    renderSnapshot(snapshot: PipelineSnapshot) {
      clearGroup(draftRoot);

      if (!snapshot.renderDrafts.length) {
        return defaultFocus.clone();
      }

      const intents = new Map<string, ObjectIntent>(
        (snapshot.normalizedPlan?.intents ?? []).map((intent) => [intent.intent_id, intent]),
      );

      const focusAccumulator = new THREE.Vector3();

      snapshot.renderDrafts.forEach((draft) => {
        const created = createDraftObject({
          draft,
          intent: intents.get(draft.intent_id),
          resolveAnchor(referenceId) {
            return referenceId ? anchors.get(referenceId)?.clone() ?? null : null;
          },
        });
        draftRoot.add(created.group);
        focusAccumulator.add(created.focusPoint);
      });

      return focusAccumulator.multiplyScalar(1 / snapshot.renderDrafts.length);
    },
  };
}

function clearGroup(group: THREE.Group) {
  group.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material: THREE.Material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });

  group.clear();
}
