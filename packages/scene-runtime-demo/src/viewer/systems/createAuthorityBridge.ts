import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";
import * as THREE from "three";

import type { SceneDocument } from "../../core";
import { createSceneObjectSync } from "./syncSceneObjects";

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
  const sync = createSceneObjectSync({
    draftRoot,
    anchors,
    defaultFocus,
  });

  return {
    renderWorld(world: AuthorityWorld, selectedObjectId: string | null = null) {
      return sync.syncWorld(world, selectedObjectId);
    },
    renderDocument(document: SceneDocument) {
      return sync.syncDocument(document);
    },
    pickObject(clientX: number, clientY: number, camera: THREE.Camera, canvas: HTMLCanvasElement) {
      return sync.pickObject(clientX, clientY, camera, canvas);
    },
    dispose() {
      sync.dispose();
    },
  };
}
