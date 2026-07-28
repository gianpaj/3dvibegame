import { describe, expect, it } from "vitest";

import {
  CollisionRegistry,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  resolveCapsuleVsBoxes,
  type Aabb,
} from "./collision";

function box(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Aabb {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

describe("resolveCapsuleVsBoxes", () => {
  it("falls to the y=0 floor and reports grounded", () => {
    const result = resolveCapsuleVsBoxes({
      start: { x: 0, y: 0.5, z: 0 },
      delta: { x: 0, y: -1, z: 0 },
      velocityY: -1,
      boxes: [],
    });
    expect(result.position.y).toBe(0);
    expect(result.velocityY).toBe(0);
    expect(result.grounded).toBe(true);
  });

  it("lands on top of a box and stands on it", () => {
    // A 2x2x2 box from y=0..2 centered at origin.
    const top = box(-1, 0, -1, 1, 2, 1);
    const result = resolveCapsuleVsBoxes({
      start: { x: 0, y: 3, z: 0 },
      delta: { x: 0, y: -2, z: 0 },
      velocityY: -2,
      boxes: [top],
    });
    expect(result.position.y).toBeCloseTo(2, 3);
    expect(result.grounded).toBe(true);
    expect(result.velocityY).toBe(0);
  });

  it("slides along a wall instead of passing through it", () => {
    // Wall occupying x>=1; walk diagonally into it. X is blocked, Z passes.
    const wall = box(1, 0, -5, 5, 3, 5);
    const result = resolveCapsuleVsBoxes({
      start: { x: 0, y: 0, z: 0 },
      delta: { x: 1, y: 0, z: 1 },
      velocityY: 0,
      boxes: [wall],
    });
    expect(result.position.x).toBeLessThanOrEqual(1 - PLAYER_RADIUS);
    expect(result.position.z).toBeCloseTo(1, 3);
  });

  it("does not snap to ground while airborne above a box", () => {
    const result = resolveCapsuleVsBoxes({
      start: { x: 0, y: 5, z: 0 },
      delta: { x: 0, y: -0.5, z: 0 },
      velocityY: -0.5,
      boxes: [box(-1, 0, -1, 1, 2, 1)],
    });
    expect(result.grounded).toBe(false);
    expect(result.position.y).toBeCloseTo(4.5, 3);
  });

  it("uses the configured capsule dimensions", () => {
    expect(PLAYER_HEIGHT).toBe(1.8);
    expect(PLAYER_RADIUS).toBeCloseTo(0.3);
  });
});

describe("CollisionRegistry", () => {
  it("registers, replaces in place by key, and unregisters", () => {
    const registry = new CollisionRegistry();
    registry.register("a@v1", box(0, 0, 0, 1, 1, 1));
    expect(registry.size).toBe(1);
    // Same key replaces rather than duplicating.
    registry.register("a@v1", box(0, 0, 0, 2, 2, 2));
    expect(registry.size).toBe(1);
    const [only] = Array.from(registry.values());
    expect(only.maxX).toBe(2);
    registry.unregister("a@v1");
    expect(registry.size).toBe(0);
  });
});
