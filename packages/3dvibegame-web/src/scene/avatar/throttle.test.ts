import { describe, expect, it } from "vitest";

import { createMoveGate, MIN_SEND_INTERVAL_MS } from "./throttle";

const at = (
  x: number,
  yaw = 0,
): { positionX: number; positionY: number; positionZ: number; rotationYaw: number } => ({
  positionX: x,
  positionY: 0,
  positionZ: 0,
  rotationYaw: yaw,
});

describe("createMoveGate", () => {
  it("sends the first sample", () => {
    const gate = createMoveGate();
    expect(gate.shouldSend(at(0), 0)).toBe(true);
  });

  it("throttles to one send per 100 ms even when moving", () => {
    const gate = createMoveGate();
    expect(gate.shouldSend(at(0), 0)).toBe(true);
    expect(gate.shouldSend(at(5), 50)).toBe(false);
    expect(gate.shouldSend(at(5), MIN_SEND_INTERVAL_MS)).toBe(true);
  });

  it("does not send when the avatar is idle (< 1 cm, < 2°)", () => {
    const gate = createMoveGate();
    expect(gate.shouldSend(at(0), 0)).toBe(true);
    // Plenty of time has passed but barely moved.
    expect(gate.shouldSend(at(0.005), 1000)).toBe(false);
  });

  it("sends after rotating more than 2 degrees", () => {
    const gate = createMoveGate();
    expect(gate.shouldSend(at(0, 0), 0)).toBe(true);
    expect(gate.shouldSend(at(0, (5 * Math.PI) / 180), 1000)).toBe(true);
  });

  it("treats yaw wrap-around as a small rotation, not a jump", () => {
    const gate = createMoveGate();
    expect(gate.shouldSend(at(0, Math.PI - 0.001), 0)).toBe(true);
    // Wraps to just past -PI: shortest arc is tiny, so no send.
    expect(gate.shouldSend(at(0, -Math.PI + 0.001), 1000)).toBe(false);
  });
});
