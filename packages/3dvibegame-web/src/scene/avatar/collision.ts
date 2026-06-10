import * as THREE from "three";

// Axis-aligned bounding box in world space, stored as plain numbers so the
// collision resolver stays a pure function that is trivial to unit test.
export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

// The player capsule is approximated as an AABB (≈ 0.6 × 1.8 × 0.6). `position`
// is the feet point (group origin); the box is centered horizontally on it and
// rises `height` above it.
export interface CapsuleState {
  position: THREE.Vector3 | { x: number; y: number; z: number };
  radius: number;
  height: number;
}

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
// Small skin so the capsule rests flush on box tops without z-fighting jitter.
const SKIN = 1e-4;

export function aabbFromBox3(box: THREE.Box3): Aabb {
  return {
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  };
}

function feetXYZ(capsule: CapsuleState) {
  const p = capsule.position;
  return { x: p.x, y: p.y, z: p.z };
}

function capsuleAabb(capsule: CapsuleState): Aabb {
  const { x, y, z } = feetXYZ(capsule);
  return {
    minX: x - capsule.radius,
    maxX: x + capsule.radius,
    minY: y,
    maxY: y + capsule.height,
    minZ: z - capsule.radius,
    maxZ: z + capsule.radius,
  };
}

function overlaps1d(aMin: number, aMax: number, bMin: number, bMax: number) {
  return aMin < bMax && aMax > bMin;
}

export interface ResolveResult {
  /** Resolved feet position. */
  position: { x: number; y: number; z: number };
  /** Resolved vertical velocity (zeroed on land / head-bonk). */
  velocityY: number;
  /** True when the capsule is resting on a box top or the y=0 floor this frame. */
  grounded: boolean;
}

/**
 * Swept-axis capsule-vs-AABB resolution against a set of static boxes plus the
 * infinite y=0 floor. Moves X, resolves; moves Z, resolves; moves Y, resolves and
 * marks `grounded` when landing on a box top or the floor. Walking into a wall
 * slides along it; standing on boxes works. Pure: no Three.js scene access.
 */
export function resolveCapsuleVsBoxes(input: {
  start: { x: number; y: number; z: number };
  delta: { x: number; y: number; z: number };
  radius?: number;
  height?: number;
  velocityY: number;
  boxes: Iterable<Aabb>;
}): ResolveResult {
  const radius = input.radius ?? PLAYER_RADIUS;
  const height = input.height ?? PLAYER_HEIGHT;
  const boxes = Array.from(input.boxes);

  const pos = { x: input.start.x, y: input.start.y, z: input.start.z };
  let velocityY = input.velocityY;
  let grounded = false;

  // --- X axis ---
  pos.x += input.delta.x;
  for (const box of boxes) {
    const cap = capsuleAabb({ position: pos, radius, height });
    if (
      overlaps1d(cap.minX, cap.maxX, box.minX, box.maxX) &&
      overlaps1d(cap.minY, cap.maxY, box.minY, box.maxY) &&
      overlaps1d(cap.minZ, cap.maxZ, box.minZ, box.maxZ)
    ) {
      pos.x =
        input.delta.x > 0
          ? box.minX - radius - SKIN
          : box.maxX + radius + SKIN;
    }
  }

  // --- Z axis ---
  pos.z += input.delta.z;
  for (const box of boxes) {
    const cap = capsuleAabb({ position: pos, radius, height });
    if (
      overlaps1d(cap.minX, cap.maxX, box.minX, box.maxX) &&
      overlaps1d(cap.minY, cap.maxY, box.minY, box.maxY) &&
      overlaps1d(cap.minZ, cap.maxZ, box.minZ, box.maxZ)
    ) {
      pos.z =
        input.delta.z > 0
          ? box.minZ - radius - SKIN
          : box.maxZ + radius + SKIN;
    }
  }

  // --- Y axis ---
  pos.y += input.delta.y;
  for (const box of boxes) {
    const cap = capsuleAabb({ position: pos, radius, height });
    if (
      overlaps1d(cap.minX, cap.maxX, box.minX, box.maxX) &&
      overlaps1d(cap.minY, cap.maxY, box.minY, box.maxY) &&
      overlaps1d(cap.minZ, cap.maxZ, box.minZ, box.maxZ)
    ) {
      if (input.delta.y <= 0) {
        // Falling onto / standing on the box top.
        pos.y = box.maxY + SKIN;
        velocityY = 0;
        grounded = true;
      } else {
        // Head bonk against the box underside.
        pos.y = box.minY - height - SKIN;
        velocityY = 0;
      }
    }
  }

  // --- Infinite y=0 floor ---
  if (pos.y <= 0) {
    pos.y = 0;
    if (velocityY < 0) velocityY = 0;
    grounded = true;
  }

  return { position: pos, velocityY, grounded };
}

/**
 * Module-level registry of world-space AABBs for rendered world objects, keyed by
 * object id + version so a box can be replaced in place when an object moves,
 * scales, or its version changes, and removed on unmount/archive. Plain map, no
 * React — the controller reads it each frame.
 */
export class CollisionRegistry {
  private boxes = new Map<string, Aabb>();

  register(key: string, box: THREE.Box3 | Aabb) {
    this.boxes.set(key, box instanceof THREE.Box3 ? aabbFromBox3(box) : box);
  }

  unregister(key: string) {
    this.boxes.delete(key);
  }

  clear() {
    this.boxes.clear();
  }

  values(): Iterable<Aabb> {
    return this.boxes.values();
  }

  get size() {
    return this.boxes.size;
  }
}

// Singleton used by the live scene; tests construct their own instances.
export const collisionRegistry = new CollisionRegistry();
