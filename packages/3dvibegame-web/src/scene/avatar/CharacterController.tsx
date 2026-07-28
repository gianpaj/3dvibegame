import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import type { OrbitControlsLike } from "./orbitControls";

import { shortestAngle } from "./angles";
import { Avatar, type AvatarMotion } from "./Avatar";
import { avatarNormalization } from "./avatarSpec";
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  resolveCapsuleVsBoxes,
  type CollisionRegistry,
} from "./collision";
import { createMoveGate, type MoveSample } from "./throttle";

const WALK_SPEED = 4; // u/s
const TURN_RATE = 10; // 1/s exponential ease of yaw toward the input heading
const GRAVITY = -22; // u/s^2
const JUMP_HEIGHT = 1.2; // u
const JUMP_VELOCITY = Math.sqrt(2 * -GRAVITY * JUMP_HEIGHT);
const RESPAWN_Y = -10;

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);

export interface CharacterControllerProps {
  controlsRef: RefObject<OrbitControlsLike | null>;
  /** True while a world object is selected: WASD moves the object, avatar idles. */
  objectSelectedRef: RefObject<boolean>;
  registry: CollisionRegistry;
  spec: BuilderSpec;
  /** Rendered size multiplier (1 = human height); from player_avatar.scale. */
  scaleFactor?: number;
  tintHue?: number;
  nickname: string;
  /** Whether the body was just swapped (triggers the in-place squash-pop). */
  spawnPop?: boolean;
  /** Called (throttled) with the avatar transform to sync via move_player. */
  onMove?: (sample: MoveSample) => void;
  /** Receives the avatar's world position each frame (sun shadow follow). */
  positionRef?: RefObject<THREE.Vector3>;
}

/**
 * Local third-person avatar controller. Holds position/velocity/yaw/grounded in
 * refs and advances them in useFrame (no React state per frame). Drives the
 * OrbitControls target to the avatar's head so mouse-drag orbits around the body.
 */
export function CharacterController({
  controlsRef,
  objectSelectedRef,
  registry,
  spec,
  scaleFactor = 1,
  tintHue,
  nickname,
  spawnPop,
  onMove,
  positionRef,
}: CharacterControllerProps) {
  const camera = useThree((state) => state.camera);

  // Follow camera looks at the rendered head, which rises for scaled-up bodies.
  // The physics capsule stays PLAYER_HEIGHT regardless — big avatars are cosmetic.
  const cameraHeadY = useMemo(
    () => avatarNormalization(spec, scaleFactor).renderedHeight * 0.9,
    [spec, scaleFactor],
  );

  const posRef = useRef(
    new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2),
  );
  const velYRef = useRef(0);
  const yawRef = useRef(0);
  const groundedRef = useRef(true);
  const justLandedRef = useRef(false);
  const keysRef = useRef(new Set<string>());
  const wantJumpRef = useRef(false);
  const gate = useMemo(() => createMoveGate(), []);

  // Live motion the Avatar reads each frame (no stale props).
  const motionRef = useRef<AvatarMotion>({
    position: posRef.current,
    yaw: 0,
    horizontalSpeed: 0,
    justLanded: false,
  });

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return (
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (key === " ") {
        if (isTypingTarget(event.target)) return;
        wantJumpRef.current = true;
        return;
      }
      if (!MOVE_KEYS.has(key)) return;
      if (isTypingTarget(event.target)) return;
      keysRef.current.add(key);
    }
    function onKeyUp(event: KeyboardEvent) {
      keysRef.current.delete(event.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30); // clamp big frame gaps for stable physics
    const pos = posRef.current;

    // Camera-relative ground basis (matches the object-move math in GameCanvas).
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    const hasForward = forward.lengthSq() > 1e-6;
    if (hasForward) forward.normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, camera.up)
      .normalize();

    // When an object is selected, WASD drives the object — the avatar idles.
    const objectMode = objectSelectedRef.current;
    const move = new THREE.Vector3();
    if (!objectMode && hasForward) {
      const keys = keysRef.current;
      if (keys.has("w")) move.add(forward);
      if (keys.has("s")) move.addScaledVector(forward, -1);
      if (keys.has("a")) move.addScaledVector(right, -1);
      if (keys.has("d")) move.add(right);
    }

    let horizontalSpeed = 0;
    if (move.lengthSq() > 1e-6) {
      // Ease yaw toward the camera-relative input heading at a finite rate and
      // walk along the *current* facing, so direction changes carve a curve
      // while the body rotates instead of both snapping instantly.
      const targetYaw = Math.atan2(move.x, move.z);
      const ease = 1 - Math.exp(-dt * TURN_RATE);
      yawRef.current += shortestAngle(yawRef.current, targetYaw) * ease;
      move
        .set(Math.sin(yawRef.current), 0, Math.cos(yawRef.current))
        .multiplyScalar(WALK_SPEED);
      horizontalSpeed = WALK_SPEED;
    }

    // Jump only when grounded.
    if (wantJumpRef.current && groundedRef.current && !objectMode) {
      velYRef.current = JUMP_VELOCITY;
      groundedRef.current = false;
    }
    wantJumpRef.current = false;

    velYRef.current += GRAVITY * dt;

    const wasGrounded = groundedRef.current;
    const result = resolveCapsuleVsBoxes({
      start: { x: pos.x, y: pos.y, z: pos.z },
      delta: { x: move.x * dt, y: velYRef.current * dt, z: move.z * dt },
      radius: PLAYER_RADIUS,
      height: PLAYER_HEIGHT,
      velocityY: velYRef.current,
      boxes: registry.values(),
    });

    pos.set(result.position.x, result.position.y, result.position.z);
    velYRef.current = result.velocityY;
    justLandedRef.current = !wasGrounded && result.grounded;
    groundedRef.current = result.grounded;

    // Respawn if we fall out of the world.
    if (pos.y < RESPAWN_Y) {
      pos.set(0, 0, 0);
      velYRef.current = 0;
    }

    // Drive the orbit target to the avatar's head so the camera follows the body.
    const controls = controlsRef.current;
    if (controls) {
      const target = controls.target as THREE.Vector3;
      const headY = pos.y + cameraHeadY;
      const camDelta = new THREE.Vector3(
        pos.x - target.x,
        headY - target.y,
        pos.z - target.z,
      );
      target.set(pos.x, headY, pos.z);
      camera.position.add(camDelta);
      controls.update();
    }

    if (positionRef?.current) positionRef.current.copy(pos);

    motionRef.current.position = pos;
    motionRef.current.yaw = yawRef.current;
    motionRef.current.horizontalSpeed = horizontalSpeed;
    motionRef.current.justLanded = justLandedRef.current;

    // Throttled outbound sync — idle players send nothing.
    if (onMove) {
      const sample: MoveSample = {
        positionX: pos.x,
        positionY: pos.y,
        positionZ: pos.z,
        rotationYaw: yawRef.current,
      };
      if (gate.shouldSend(sample, performance.now())) onMove(sample);
    }
  });

  return (
    <Avatar
      spec={spec}
      scaleFactor={scaleFactor}
      tintHue={tintHue}
      motionRef={motionRef}
      nickname={nickname}
      spawnPop={spawnPop}
    />
  );
}
