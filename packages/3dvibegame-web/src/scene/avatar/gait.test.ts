import { describe, expect, it } from "vitest";

import {
  advanceGaitPhase,
  createGaitState,
  evaluateGait,
  triggerLandingSquash,
} from "./gait";

describe("gait phase", () => {
  it("does not advance phase when speed is zero (no foot-sliding)", () => {
    const phase = advanceGaitPhase(1.23, 0, 0.016);
    expect(phase).toBe(1.23);
  });

  it("advances phase proportional to distance walked", () => {
    const a = advanceGaitPhase(0, 4, 0.1); // 0.4 units
    const b = advanceGaitPhase(0, 2, 0.2); // 0.4 units
    expect(a).toBeCloseTo(b, 6);
  });

  it("zeroes bob and tilt while idle", () => {
    const out = evaluateGait({
      phase: 0.7,
      horizontalSpeed: 0,
      elapsedSeconds: 0,
      landTimer: 0,
    });
    expect(out.bobY).toBe(0);
    expect(out.tilt).toBe(0);
    expect(out.lean).toBe(0);
  });

  it("produces a non-zero bob while moving", () => {
    const out = evaluateGait({
      phase: Math.PI / 4,
      horizontalSpeed: 4,
      elapsedSeconds: 0,
      landTimer: 0,
    });
    expect(Math.abs(out.bobY)).toBeGreaterThan(0);
    expect(out.lean).toBeGreaterThan(0);
  });

  it("squashes to ~0.85 right after landing and eases back to 1", () => {
    const full = triggerLandingSquash();
    const justLanded = evaluateGait({
      phase: 0,
      horizontalSpeed: 0,
      elapsedSeconds: 0,
      landTimer: full,
    });
    expect(justLanded.scaleY).toBeCloseTo(0.85, 2);

    const recovered = evaluateGait({
      phase: 0,
      horizontalSpeed: 0,
      elapsedSeconds: 0,
      landTimer: 0,
    });
    expect(recovered.scaleY).toBeCloseTo(1, 1);
  });

  it("createGaitState starts at rest", () => {
    expect(createGaitState()).toEqual({ phase: 0, landTimer: 0 });
  });
});
