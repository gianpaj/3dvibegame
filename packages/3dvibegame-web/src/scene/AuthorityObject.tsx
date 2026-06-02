import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { AuthorityObject as AuthorityObjectType } from "@3dvibegame/scene-authority-ts";
import { createAuthorityObject } from "../viewer/objects/createAuthorityObject";

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
