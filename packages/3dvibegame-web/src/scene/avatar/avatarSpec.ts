import {
  compileVoxelBuilderSpec,
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import defaultAvatarVoxel from "../../fixtures/avatar-forest-guardian.voxel-builder.json";

// Rendered height of a scale-1 avatar. The controller's capsule is 1.8 u tall,
// so feet sit at the group origin and the head reaches ~1.8 u.
export const AVATAR_TARGET_HEIGHT = 1.8;

// Rendered size multiplier bounds (kept in sync with world-backend
// set_avatar_spec). Geometry is always normalized to human height; the explicit
// per-avatar `scale` is what makes a body giant ("4 times larger" → 4).
export const AVATAR_MIN_SCALE = 0.25;
export const AVATAR_MAX_SCALE = 4;

// Server-enforced geometry clamp (kept in sync with world-backend
// set_avatar_spec). Guards against extreme geometry only — rendered size comes
// from `scale`, not from how big the parts are.
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
 * Uniform scale + Y offset that places an avatar's feet at the group origin and
 * scales it so its height equals AVATAR_TARGET_HEIGHT × scaleFactor. Geometry
 * size never affects rendered size — only the explicit scaleFactor does, so
 * every body renders human-sized unless its owner asked to grow/shrink.
 * Returned as plain numbers so it is testable without Three.js.
 */
export function avatarNormalization(
  spec: BuilderSpec,
  scaleFactor = 1,
): {
  scale: number;
  offsetY: number;
  /** Final rendered height in world units (nameplate / camera anchor). */
  renderedHeight: number;
} {
  const clamped = clampAvatarScale(scaleFactor);
  const bounds = computeBuilderBounds(spec);
  const height = bounds.size[1];
  const renderedHeight = AVATAR_TARGET_HEIGHT * clamped;
  const scale = height > 1e-3 ? renderedHeight / height : 1;
  // After scaling, lift so the lowest point sits on y=0.
  const offsetY = -bounds.min[1] * scale;
  return { scale, offsetY, renderedHeight };
}

/** Clamp a stored/AI-provided scale into the allowed range (bad data → 1). */
export function clampAvatarScale(scale: number | null | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return Math.min(AVATAR_MAX_SCALE, Math.max(AVATAR_MIN_SCALE, scale));
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
