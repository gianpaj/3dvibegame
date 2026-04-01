import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";
import * as THREE from "three";

import { listRenderableSceneObjects, type SceneDocument } from "../../core";
import { createAuthorityObject } from "../objects/createAuthorityObject";
import { createObjectRegistry } from "../registry/objectRegistry";

interface SceneObjectSyncConfig {
  draftRoot: THREE.Group;
  anchors: Map<string, THREE.Vector3>;
  defaultFocus: THREE.Vector3;
}

export function createSceneObjectSync({
  draftRoot,
  anchors,
  defaultFocus,
}: SceneObjectSyncConfig) {
  const registry = createObjectRegistry();
  const raycaster = new THREE.Raycaster();
  let selectedObjectId: string | null = null;

  return {
    syncWorld(world: AuthorityWorld) {
      return this.syncDocument({
        objects_by_id: Object.fromEntries(
          world.objects.map((object) => [
            object.object_id,
            {
              object_id: object.object_id,
              authority: object,
              voxel_artifact: null,
              compiled_artifact: null,
              diagnostics: [],
            },
          ]),
        ),
        root_object_ids: world.objects.map((object) => object.object_id),
        shared_dirty: {
          source_dirty_ids: [],
          artifact_dirty_ids: [],
          render_dirty_ids: world.objects.map((object) => object.object_id),
        },
        player_sessions_by_id: {},
      });
    },
    syncDocument(document: SceneDocument) {
      const records = listRenderableSceneObjects(document);
      const currentSession =
        Object.values(document.player_sessions_by_id)[0] ?? null;
      const nextSelectedObjectId = currentSession?.selection.selected_object_id ?? null;
      const currentIds = new Set(records.map((record) => record.object_id));

      registry.listObjectIds().forEach((objectId) => {
        if (currentIds.has(objectId)) return;
        const entry = registry.get(objectId);
        if (!entry) return;
        draftRoot.remove(entry.group);
        disposeGroup(entry.group);
        registry.delete(objectId);
      });

      const dirtyIds = new Set(document.shared_dirty.render_dirty_ids);
      if (selectedObjectId) {
        dirtyIds.add(selectedObjectId);
      }
      if (nextSelectedObjectId) {
        dirtyIds.add(nextSelectedObjectId);
      }

      records.forEach((record) => {
        const needsSync = dirtyIds.has(record.object_id) || !registry.has(record.object_id);
        if (!needsSync) return;

        const existing = registry.get(record.object_id);
        if (existing) {
          draftRoot.remove(existing.group);
          disposeGroup(existing.group);
          registry.delete(record.object_id);
        }

        const created = createAuthorityObject({
          object: record.authority,
          selected: record.object_id === nextSelectedObjectId,
          resolveAnchor(referenceId) {
            return referenceId ? anchors.get(referenceId)?.clone() ?? null : null;
          },
        });

        draftRoot.add(created.group);
        registry.register({
          objectId: record.object_id,
          group: created.group,
          focusPoint: created.focusPoint.clone(),
          renderClass: record.authority.builder_spec.object_category,
        });
      });

      if (!records.length) {
        selectedObjectId = nextSelectedObjectId;
        return defaultFocus.clone();
      }

      const focusAccumulator = new THREE.Vector3();

      records.forEach((record) => {
        const entry = registry.get(record.object_id);
        if (!entry) return;
        focusAccumulator.add(entry.focusPoint);
      });

      selectedObjectId = nextSelectedObjectId;
      return focusAccumulator.multiplyScalar(1 / Math.max(records.length, 1));
    },
    pickObject(clientX: number, clientY: number, camera: THREE.Camera, canvas: HTMLCanvasElement) {
      const bounds = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
        -((clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(
        registry.listEntries().map((entry) => entry.group),
        true,
      );

      for (const hit of hits) {
        const objectId = findObjectId(hit.object);
        if (objectId) {
          return objectId;
        }
      }

      return null;
    },
    dispose() {
      registry.listObjectIds().forEach((objectId) => {
        const entry = registry.get(objectId);
        if (!entry) return;
        draftRoot.remove(entry.group);
        disposeGroup(entry.group);
      });
      registry.clear();
    },
  };
}

function findObjectId(object: THREE.Object3D | null) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.objectId === "string") {
      return current.userData.objectId;
    }
    current = current.parent;
  }
  return null;
}

function disposeGroup(group: THREE.Group) {
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
}
