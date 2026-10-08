import type { Vec3 } from "./contract";
import { boundsCenter, fitCamera, VIEWS, viewDirection } from "./framing";

function corners(min: Vec3, max: Vec3): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) points.push([x, y, z]);
  return points;
}

// Projects a point to normalised device coordinates for a pose.
function project(pose: ReturnType<typeof fitCamera>, aspect: number, point: Vec3) {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a: Vec3) => Math.hypot(...a);
  const forward = sub(pose.target, pose.position).map((v) => v / len(sub(pose.target, pose.position))) as Vec3;
  const up = pose.up;
  const right: Vec3 = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ];
  const rel = sub(point, pose.position);
  const depth = dot(rel, forward);
  const tanV = Math.tan((pose.fov_degrees * Math.PI) / 360);
  return { x: dot(rel, right) / (depth * tanV * aspect), y: dot(rel, up) / (depth * tanV), depth };
}

const shapes: Record<string, { min: Vec3; max: Vec3 }> = {
  cube: { min: [-1, 0, -1], max: [1, 2, 1] },
  pole: { min: [-0.25, 0, -0.25], max: [0.25, 10, 0.25] },
  rug: { min: [-3, 0, -2], max: [3, 0.1, 2] },
  offset: { min: [10, 5, -4], max: [12, 6, -3] },
};

describe("capture framing", () => {
  it("defines three fixed, distinct labelled views", () => {
    expect(VIEWS.map((v) => v.view_id)).toEqual(["front_three_quarter", "opposite_three_quarter", "elevated"]);
    const directions = VIEWS.map((v) => viewDirection(v).map((c) => c.toFixed(3)).join());
    expect(new Set(directions).size).toBe(3);
  });

  it.each(Object.entries(shapes))("keeps every point of a %s inside the frame with padding", (_, bounds) => {
    const points = corners(bounds.min, bounds.max);
    for (const view of VIEWS) {
      const pose = fitCamera(points, boundsCenter(bounds), viewDirection(view), 35, 1, 1.12);
      const projected = points.map((p) => project(pose, 1, p));
      for (const p of projected) {
        expect(p.depth).toBeGreaterThan(pose.near);
        expect(p.depth).toBeLessThan(pose.far);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / 1.12 + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / 1.12 + 1e-9);
      }
      // The tightest axis touches the padded edge: apparent size is normalised.
      const extent = Math.max(...projected.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
      expect(extent).toBeCloseTo(1 / 1.12, 6);
    }
  });

  it("normalises apparent size regardless of world scale", () => {
    const small = corners([-1, 0, -1], [1, 2, 1]);
    const large = small.map((p) => p.map((c) => c * 50) as Vec3);
    const [view] = VIEWS;
    const a = fitCamera(small, [0, 1, 0], viewDirection(view!), 35, 1, 1.12);
    const b = fitCamera(large, [0, 50, 0], viewDirection(view!), 35, 1, 1.12);
    const ndc = (pose: typeof a, pts: Vec3[]) => pts.map((p) => project(pose, 1, p).x.toFixed(6));
    expect(ndc(a, small)).toEqual(ndc(b, large));
  });
});
