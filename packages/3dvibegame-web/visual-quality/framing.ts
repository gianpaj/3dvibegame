import type { CameraPose, Vec3, ViewId } from "./contract";

// Pure camera framing for capture views: no three.js, so it is unit-testable
// and the runner can reason about it.

export interface ViewDefinition {
  view_id: ViewId;
  label: string;
  // Degrees around +Y, measured from +Z (the object's front) toward +X.
  azimuth_degrees: number;
  // Degrees above the horizontal.
  elevation_degrees: number;
}

// Fixed for every sample: objects are never rotated to a hand-picked best view.
export const VIEWS: readonly ViewDefinition[] = [
  { view_id: "front_three_quarter", label: "View 1 of 3: front three-quarter", azimuth_degrees: 35, elevation_degrees: 20 },
  { view_id: "opposite_three_quarter", label: "View 2 of 3: opposite three-quarter", azimuth_degrees: 215, elevation_degrees: 20 },
  { view_id: "elevated", label: "View 3 of 3: elevated", azimuth_degrees: -55, elevation_degrees: 55 },
];

export function viewDirection(view: ViewDefinition): Vec3 {
  const az = (view.azimuth_degrees * Math.PI) / 180;
  const el = (view.elevation_degrees * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

// Places a perspective camera on `direction` from `target` at the smallest
// distance that keeps every point inside the frustum, scaled by `padding`.
// Fitting the actual vertices per view keeps extreme aspect ratios (poles,
// rugs) and sparse layouts filling the frame consistently.
export function fitCamera(
  points: Vec3[],
  target: Vec3,
  direction: Vec3,
  fovDegrees: number,
  aspect: number,
  padding: number,
): CameraPose {
  const d = normalize(direction);
  const forward = scale(d, -1);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanV = Math.tan((fovDegrees * Math.PI) / 360);
  const tanH = tanV * aspect;

  const projected = points.map((point) => {
    const rel = sub(point, target);
    return { x: dot(rel, right), y: dot(rel, up), z: dot(rel, d) };
  });
  const distance = Math.max(
    ...projected.map((p) => p.z + Math.max((Math.abs(p.x) * padding) / tanH, (Math.abs(p.y) * padding) / tanV)),
  );
  const depths = projected.map((p) => distance - p.z);

  return {
    position: add(target, scale(d, distance)),
    target,
    up,
    fov_degrees: fovDegrees,
    near: Math.max(0.01, Math.min(...depths) * 0.5),
    far: Math.max(...depths) * 2 + 1,
  };
}

export function boundsCenter({ min, max }: { min: Vec3; max: Vec3 }): Vec3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
