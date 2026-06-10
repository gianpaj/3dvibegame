import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import {
  buildAvatarMesh,
  disposeAvatarGroup,
} from "./buildAvatarMesh";
import {
  advanceGaitPhase,
  evaluateGait,
  triggerLandingSquash,
  type GaitState,
} from "./gait";
import { avatarNormalization } from "./avatarSpec";

/** Live, per-frame avatar motion read inside useFrame so values never go stale. */
export interface AvatarMotion {
  position: THREE.Vector3 | { x: number; y: number; z: number };
  yaw: number;
  horizontalSpeed: number;
  justLanded: boolean;
}

export interface AvatarProps {
  /** The body to render. */
  spec: BuilderSpec;
  /** HSL hue used to tint the default body; omit for prompt-made bodies. */
  tintHue?: number;
  /** Ref holding the live motion, updated each frame by the owning controller. */
  motionRef: RefObject<AvatarMotion>;
  /** Nickname shown on the billboard nameplate. */
  nickname: string;
  /** Squash-pop feedback when the body is swapped in place. */
  spawnPop?: boolean;
}

/**
 * Renders a voxel avatar body with the procedural distance-driven gait. The same
 * component is used for the local (predicted) and remote (interpolated) avatars, so
 * remote players walk rather than glide.
 */
export function Avatar({
  spec,
  tintHue,
  motionRef,
  nickname,
  spawnPop = false,
}: AvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const gaitRef = useRef<GaitState>({ phase: 0, landTimer: 0 });
  const elapsedRef = useRef(0);
  const popRef = useRef(0);
  const wasLandedRef = useRef(false);

  const mesh = useMemo(
    () => buildAvatarMesh(spec, { tintHue }),
    [spec, tintHue],
  );
  // Oversized bodies render oversized — keep the nameplate above the head.
  const renderedHeight = useMemo(
    () => avatarNormalization(spec).renderedHeight,
    [spec],
  );

  useEffect(() => {
    return () => disposeAvatarGroup(mesh);
  }, [mesh]);

  // Squash-pop when the body swaps in place (new spec / version).
  useEffect(() => {
    if (spawnPop) popRef.current = 0.18;
  }, [spawnPop, spec]);

  useFrame((_, dt) => {
    const group = groupRef.current;
    const body = bodyRef.current;
    if (!group || !body) return;

    const { position, yaw, horizontalSpeed, justLanded } = motionRef.current;

    elapsedRef.current += dt;
    const gait = gaitRef.current;

    if (justLanded && !wasLandedRef.current) {
      gait.landTimer = triggerLandingSquash();
    }
    wasLandedRef.current = justLanded;
    if (gait.landTimer > 0) gait.landTimer = Math.max(0, gait.landTimer - dt);

    gait.phase = advanceGaitPhase(gait.phase, horizontalSpeed, dt);
    const out = evaluateGait({
      phase: gait.phase,
      horizontalSpeed,
      elapsedSeconds: elapsedRef.current,
      landTimer: gait.landTimer,
    });

    // Place + face the avatar.
    group.position.set(position.x, position.y + out.bobY, position.z);
    group.rotation.y = yaw;

    // Body-level gait transforms (tilt about forward axis, forward lean, squash).
    body.rotation.z = out.tilt;
    body.rotation.x = out.lean;

    let scaleY = out.scaleY;
    if (popRef.current > 0) {
      popRef.current = Math.max(0, popRef.current - dt);
      scaleY *= 1 + popRef.current * 1.2;
    }
    body.scale.y = scaleY;
  });

  return (
    <group ref={groupRef}>
      <group ref={bodyRef}>
        <primitive object={mesh} />
      </group>
      <Billboard position={[0, renderedHeight + 0.35, 0]}>
        <Text
          fontSize={0.28}
          color="#ffffff"
          outlineColor="#1a1a1a"
          outlineWidth={0.02}
          anchorX="center"
          anchorY="middle"
        >
          {nickname}
        </Text>
      </Billboard>
    </group>
  );
}
