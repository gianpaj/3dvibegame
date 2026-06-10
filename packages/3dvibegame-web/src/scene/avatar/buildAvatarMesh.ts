import * as THREE from "three";
import type { AuthorityObject, BuilderSpec } from "@3dvibegame/scene-authority-ts";

import { createAuthorityObject } from "../../viewer/objects/createAuthorityObject";
import { avatarNormalization, hueFromIdentity } from "./avatarSpec";

// Wrap a bare BuilderSpec into the minimal AuthorityObject shape the voxel mesh
// path needs. Rendered as a settled "public" object (no grace/lock rings).
function asAuthorityObject(spec: BuilderSpec): AuthorityObject {
  return {
    object_id: "avatar",
    world_id: "0",
    state: "public",
    version: 1,
    created_by: "",
    latest_editor: "",
    grace_owner_id: null,
    lock_owner_id: null,
    builder_spec: spec,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    cooldown_remaining_seconds: 0,
    grace_remaining_seconds: 0,
  };
}

/**
 * Build a normalized avatar group from a builder spec: voxel mesh path, scaled so
 * its height is ~1.8 u with feet at the group origin. When `tintHue` is provided
 * (default body), every mesh material is HSL-tinted with that hue so each player's
 * default body is visually distinct.
 */
export function buildAvatarMesh(
  spec: BuilderSpec,
  options: { tintHue?: number } = {},
): THREE.Group {
  const inner = createAuthorityObject({
    object: asAuthorityObject(spec),
    selected: false,
    resolveAnchor: () => null,
  }).group;

  const { scale, offsetY } = avatarNormalization(spec);
  inner.scale.setScalar(scale);
  inner.position.y = offsetY;

  if (options.tintHue !== undefined) {
    tintGroup(inner, options.tintHue);
  }

  // Outer wrapper keeps feet at the wrapper origin so the controller can place it
  // directly at the avatar's feet position.
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

export function hueFromIdentityOrDefault(identityHex: string | null): number {
  return identityHex ? hueFromIdentity(identityHex) : 0.55;
}

function tintGroup(group: THREE.Group, hue: number) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach((mat) => {
        const standard = mat as THREE.Material & { color?: THREE.Color };
        if (standard.color) {
          const hsl = { h: 0, s: 0, l: 0 };
          standard.color.getHSL(hsl);
          standard.color.setHSL(hue, Math.max(hsl.s, 0.45), hsl.l);
        }
      });
    }
  });
}

export function disposeAvatarGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach((m: THREE.Material) => m.dispose());
    }
  });
}
