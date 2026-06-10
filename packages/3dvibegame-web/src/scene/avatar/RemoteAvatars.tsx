import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import { Avatar, type AvatarMotion } from "./Avatar";

const SMOOTH_TIME = 0.15; // ~150 ms exponential smoothing

export interface RemoteAvatarData {
  id: string;
  nickname: string;
  spec: BuilderSpec;
  /** Rendered size multiplier (1 = human height); from player_avatar.scale. */
  scaleFactor?: number;
  tintHue?: number;
  target: { x: number; y: number; z: number; yaw: number };
  /** Bumped when the body spec changes so we can squash-pop on swap. */
  specVersion: number;
}

interface Props {
  avatars: RemoteAvatarData[];
}

/** Renders all non-local players, each interpolated toward its latest transform. */
export function RemoteAvatars({ avatars }: Props) {
  return (
    <>
      {avatars.map((avatar) => (
        <RemoteAvatar key={avatar.id} data={avatar} />
      ))}
    </>
  );
}

function shortestYaw(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

function RemoteAvatar({ data }: { data: RemoteAvatarData }) {
  const posRef = useRef(
    new THREE.Vector3(data.target.x, data.target.y, data.target.z),
  );
  const yawRef = useRef(data.target.yaw);
  const motionRef = useRef<AvatarMotion>({
    position: posRef.current,
    yaw: data.target.yaw,
    horizontalSpeed: 0,
    justLanded: false,
  });
  const prevSpecVersion = useRef(data.specVersion);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const pos = posRef.current;
    const prev = { x: pos.x, z: pos.z };

    // Exponential smoothing toward the latest server transform; remote gait derives
    // from the resulting interpolated velocity, so remote players walk, not glide.
    const alpha = 1 - Math.exp(-dt / SMOOTH_TIME);
    pos.x += (data.target.x - pos.x) * alpha;
    pos.y += (data.target.y - pos.y) * alpha;
    pos.z += (data.target.z - pos.z) * alpha;
    yawRef.current = shortestYaw(yawRef.current, data.target.yaw, alpha);

    const dx = pos.x - prev.x;
    const dz = pos.z - prev.z;
    const horizontalSpeed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;

    motionRef.current.position = pos;
    motionRef.current.yaw = yawRef.current;
    motionRef.current.horizontalSpeed = horizontalSpeed;
    motionRef.current.justLanded = false;
  });

  const spawnPop = useMemo(() => {
    const changed = data.specVersion !== prevSpecVersion.current;
    prevSpecVersion.current = data.specVersion;
    return changed;
  }, [data.specVersion]);

  return (
    <Avatar
      spec={data.spec}
      scaleFactor={data.scaleFactor}
      tintHue={data.tintHue}
      motionRef={motionRef}
      nickname={data.nickname}
      spawnPop={spawnPop}
    />
  );
}
