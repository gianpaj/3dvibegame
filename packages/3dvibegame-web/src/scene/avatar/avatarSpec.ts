import {
  compileVoxelBuilderSpec,
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import defaultAvatarVoxel from "../../fixtures/avatar-forest-guardian.voxel-builder.json";

// Rendered height of a normal-sized avatar. The controller's capsule is 1.8 u
// tall, so feet sit at the group origin and the head reaches ~1.8 u.
export const AVATAR_TARGET_HEIGHT = 1.8;

// Spec height (in voxel grid units) that maps to AVATAR_TARGET_HEIGHT. Specs up
// to this tall all render at 1.8 u (human-size); taller specs grow
// proportionally, so a 12-tall spec renders at 4× human height (7.2 u).
export const AVATAR_BASE_HEIGHT = 3;

// Server-enforced clamp (kept in sync with world-backend set_avatar_spec): the
// compiled, pre-normalization bounds must fit 8 × 12 × 8 units (4× a normal
// 2 × 3 × 2 body, so "make me 4 times larger" is allowed).
export const AVATAR_CLAMP = { width: 8, height: 12, depth: 8 } as const;

export interface AvatarBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

/** Axis-aligned bounds of a builder spec's parts in local (pre-instance) space. */
export function computeBuilderBounds(spec: BuilderSpec): AvatarBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const part of spec.parts) {
    const [dx, dy, dz] = part.dimensions;
    const [cx, cy, cz] = part.local_position ?? [0, 0, 0];
    minX = Math.min(minX, cx - dx / 2);
    maxX = Math.max(maxX, cx + dx / 2);
    minY = Math.min(minY, cy - dy / 2);
    maxY = Math.max(maxY, cy + dy / 2);
    minZ = Math.min(minZ, cz - dz / 2);
    maxZ = Math.max(maxZ, cz + dz / 2);
  }

  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** Mirrors the backend size gate so the client can reject before round-tripping. */
export function fitsAvatarClamp(spec: BuilderSpec): boolean {
  const { size } = computeBuilderBounds(spec);
  return (
    size[0] <= AVATAR_CLAMP.width &&
    size[1] <= AVATAR_CLAMP.height &&
    size[2] <= AVATAR_CLAMP.depth
  );
}

/**
 * Uniform scale + Y offset that places an avatar's feet at the group origin.
 * Specs up to AVATAR_BASE_HEIGHT tall normalize to AVATAR_TARGET_HEIGHT
 * (human-size); taller specs keep their proportion, so oversized bodies render
 * oversized. Returned as plain numbers so it is testable without Three.js.
 */
export function avatarNormalization(spec: BuilderSpec): {
  scale: number;
  offsetY: number;
  /** Final rendered height in world units (nameplate / camera anchor). */
  renderedHeight: number;
} {
  const bounds = computeBuilderBounds(spec);
  const height = bounds.size[1];
  const scale =
    height > 1e-3
      ? AVATAR_TARGET_HEIGHT / Math.min(height, AVATAR_BASE_HEIGHT)
      : 1;
  // After scaling, lift so the lowest point sits on y=0.
  const offsetY = -bounds.min[1] * scale;
  return { scale, offsetY, renderedHeight: height * scale };
}

// Deterministic hue (0..1) derived from an identity hex so each player's default
// body has a stable, distinct tint without any stored state.
export function hueFromIdentity(identityHex: string): number {
  let hash = 0;
  for (let i = 0; i < identityHex.length; i++) {
    hash = (hash * 31 + identityHex.charCodeAt(i)) >>> 0;
  }
  return (hash % 360) / 360;
}

let cachedDefaultBody: BuilderSpec | null = null;

/** The hardcoded chunky default body, compiled once and cached. */
export function defaultAvatarBuilderSpec(): BuilderSpec {
  if (!cachedDefaultBody) {
    cachedDefaultBody = compileVoxelBuilderSpec(
      parseVoxelBuilderSpec(defaultAvatarVoxel),
    ) as BuilderSpec;
  }
  return cachedDefaultBody;
}

export function defaultAvatarVoxelCore(): unknown {
  return defaultAvatarVoxel;
}

/**
 * Parse a stored builder spec JSON into a BuilderSpec, returning null when it is
 * malformed so the caller can fall back to the default body (never bodiless).
 */
export function parseStoredAvatarSpec(builderSpecJson: string): BuilderSpec | null {
  try {
    const parsed = JSON.parse(builderSpecJson);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.parts)) {
      return null;
    }
    return parsed as BuilderSpec;
  } catch {
    return null;
  }
}
