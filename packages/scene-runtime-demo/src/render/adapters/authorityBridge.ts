import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";
import * as THREE from "three";

import { createAuthorityObject } from "../objects/createAuthorityObject";

interface AuthorityBridgeConfig {
  draftRoot: THREE.Group;
  anchors: Map<string, THREE.Vector3>;
  defaultFocus: THREE.Vector3;
}

export function createAuthorityBridge({
  draftRoot,
  anchors,
  defaultFocus,
}: AuthorityBridgeConfig) {
  return {
    renderWorld(world: AuthorityWorld) {
      clearGroup(draftRoot);

      if (!world.objects.length) {
        return defaultFocus.clone();
      }

      const focusAccumulator = new THREE.Vector3();

      world.objects.forEach((object) => {
        if (object.state === "deleted" || object.state === "archived") {
          return;
        }

        const created = createAuthorityObject({
          object,
          resolveAnchor(referenceId) {
            return referenceId ? anchors.get(referenceId)?.clone() ?? null : null;
          },
        });
        draftRoot.add(created.group);
        focusAccumulator.add(created.focusPoint);
      });

      return focusAccumulator.multiplyScalar(1 / Math.max(world.objects.length, 1));
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
