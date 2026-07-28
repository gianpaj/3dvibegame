import { describe, expect, it } from "vitest";

import { shortestAngle } from "./angles";

describe("shortestAngle", () => {
  it("returns the plain difference for small gaps", () => {
    expect(shortestAngle(0, 0.5)).toBeCloseTo(0.5);
    expect(shortestAngle(0.5, 0)).toBeCloseTo(-0.5);
  });

  it("wraps across the ±π seam instead of going the long way", () => {
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(shortestAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });

  it("handles inputs outside [-π, π]", () => {
    expect(shortestAngle(0, 2 * Math.PI)).toBeCloseTo(0);
    expect(shortestAngle(0, 5 * Math.PI)).toBeCloseTo(Math.PI);
    expect(shortestAngle(4 * Math.PI, 0.3)).toBeCloseTo(0.3);
  });

  it("never returns more than a half turn", () => {
    for (let from = -7; from <= 7; from += 0.37) {
      for (let to = -7; to <= 7; to += 0.41) {
        const delta = shortestAngle(from, to);
        expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI + 1e-9);
        // Walking by delta lands on the target heading (mod 2π).
        const landed = shortestAngle(from + delta, to);
        expect(landed).toBeCloseTo(0);
      }
    }
  });
});
