import { describe, expect, it } from "vitest";

import {
  parseTimeOfDayOverride,
  skyStateAtHours,
  skyStateAtUtc,
  smoothstep,
} from "./sunPosition";

describe("skyStateAtHours", () => {
  it("puts the sun overhead at noon", () => {
    const sky = skyStateAtHours(12);
    expect(sky.sunElevation).toBeCloseTo(1);
    expect(sky.sunDirection.y).toBeGreaterThan(0.9);
    expect(sky.moonElevation).toBeCloseTo(-1);
  });

  it("puts the moon overhead at midnight", () => {
    const sky = skyStateAtHours(0);
    expect(sky.sunElevation).toBeCloseTo(-1);
    expect(sky.moonDirection.y).toBeGreaterThan(0.9);
    expect(sky.moonElevation).toBeCloseTo(1);
  });

  it("rises in the east (+x) at 06:00 and sets in the west (-x) at 18:00", () => {
    const sunrise = skyStateAtHours(6);
    expect(sunrise.sunElevation).toBeCloseTo(0);
    expect(sunrise.sunDirection.x).toBeGreaterThan(0.9);

    const sunset = skyStateAtHours(18);
    expect(sunset.sunElevation).toBeCloseTo(0);
    expect(sunset.sunDirection.x).toBeLessThan(-0.9);
  });

  it("returns unit directions with the orbit tilted off the zenith", () => {
    for (const hours of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const { sunDirection: s, moonDirection: m } = skyStateAtHours(hours);
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1);
      expect(Math.hypot(m.x, m.y, m.z)).toBeCloseTo(1);
      // Tilt keeps both bodies south of straight-up (shadows never degenerate).
      expect(s.z).toBeGreaterThan(0);
      expect(m.z).toBeGreaterThan(0);
    }
  });
});

describe("skyStateAtUtc", () => {
  it("matches the fractional-hours form", () => {
    const date = new Date(Date.UTC(2026, 5, 12, 18, 30, 0));
    const fromDate = skyStateAtUtc(date);
    const fromHours = skyStateAtHours(18.5);
    expect(fromDate.sunElevation).toBeCloseTo(fromHours.sunElevation);
    expect(fromDate.sunDirection.x).toBeCloseTo(fromHours.sunDirection.x);
  });
});

describe("parseTimeOfDayOverride", () => {
  it("parses fractional hours", () => {
    expect(parseTimeOfDayOverride("?timeOfDay=18.5")).toBeCloseTo(18.5);
  });

  it("wraps out-of-range values into [0, 24)", () => {
    expect(parseTimeOfDayOverride("?timeOfDay=25")).toBeCloseTo(1);
    expect(parseTimeOfDayOverride("?timeOfDay=-6")).toBeCloseTo(18);
  });

  it("returns null when absent or invalid", () => {
    expect(parseTimeOfDayOverride("")).toBeNull();
    expect(parseTimeOfDayOverride("?foo=1")).toBeNull();
    expect(parseTimeOfDayOverride("?timeOfDay=abc")).toBeNull();
  });
});

describe("smoothstep", () => {
  it("clamps and eases", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});
