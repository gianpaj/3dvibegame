import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { AuthorityObject as AuthorityObjectType } from "@3dvibegame/scene-authority-ts";
import { createAuthorityObject } from "../viewer/objects/createAuthorityObject";
import { collisionRegistry } from "./avatar/collision";

interface Props {
  object: AuthorityObjectType;
  selected: boolean;
  onSelect?: (objectId: string) => void;
}

export function AuthorityObject({ object, selected, onSelect }: Props) {
  const group = useMemo(
    () =>
      createAuthorityObject({
        object,
        selected,
        resolveAnchor: () => null,
      }).group,
    // Parent keys on state/version/selected to force remount on meaningful changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    return () => disposeGroup(group);
  }, [group]);

  // Register this object's world-space AABB so the avatar controller can collide
  // with and stand on it. SceneObjects keys this component on state/version/
  // transform, so it remounts (re-registering a fresh box) whenever the object
  // moves, scales, or changes version. Unregister on unmount/archive.
  useEffect(() => {
    // The box is computed from the rendered group once it is mounted in the scene.
    const key = `${object.object_id}@v${object.version}`;
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      collisionRegistry.register(key, box);
    }
    return () => collisionRegistry.unregister(key);
  }, [group, object.object_id, object.version]);

  return (
    <primitive
      object={group}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onSelect?.(object.object_id);
      }}
    />
  );
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m: THREE.Material) => m.dispose());
    }
  });
}
