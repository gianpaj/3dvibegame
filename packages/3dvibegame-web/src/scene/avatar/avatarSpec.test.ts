import { describe, expect, it } from "vitest";
import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import {
  AVATAR_TARGET_HEIGHT,
  avatarNormalization,
  computeBuilderBounds,
  defaultAvatarBuilderSpec,
  fitsAvatarClamp,
  hueFromIdentity,
  parseStoredAvatarSpec,
} from "./avatarSpec";

function specFromParts(
  parts: { dimensions: [number, number, number]; local_position?: [number, number, number] }[],
): BuilderSpec {
  return {
    parts: parts.map((p, i) => ({
      part_id: `p${i}`,
      primitive: "box",
      material: "stone",
      modifiers: [],
      dimensions: p.dimensions,
      local_position: p.local_position,
    })),
  } as unknown as BuilderSpec;
}

describe("computeBuilderBounds", () => {
  it("spans all parts", () => {
    const bounds = computeBuilderBounds(
      specFromParts([
        { dimensions: [1, 1, 1], local_position: [0, 0.5, 0] },
        { dimensions: [1, 1, 1], local_position: [0, 2.5, 0] },
      ]),
    );
    expect(bounds.size[1]).toBeCloseTo(3); // y from 0 to 3
  });
});

describe("fitsAvatarClamp", () => {
  it("accepts a body within 2x3x2", () => {
    expect(
      fitsAvatarClamp(specFromParts([{ dimensions: [1.5, 2.8, 1.5] }])),
    ).toBe(true);
  });

  it("rejects a body taller than 3 units", () => {
    expect(
      fitsAvatarClamp(specFromParts([{ dimensions: [1, 4, 1] }])),
    ).toBe(false);
  });

  it("rejects a body wider than 2 units", () => {
    expect(
      fitsAvatarClamp(specFromParts([{ dimensions: [2.5, 1, 1] }])),
    ).toBe(false);
  });
});

describe("avatarNormalization", () => {
  it("scales to the target height and lifts feet to y=0", () => {
    // Body from y=1 to y=2 (height 1), so scale = 1.8 and feet lift to origin.
    const norm = avatarNormalization(
      specFromParts([{ dimensions: [1, 1, 1], local_position: [0, 1.5, 0] }]),
    );
    expect(norm.scale).toBeCloseTo(AVATAR_TARGET_HEIGHT);
    expect(norm.offsetY).toBeCloseTo(-1 * AVATAR_TARGET_HEIGHT);
  });
});

describe("hueFromIdentity", () => {
  it("is deterministic and within [0,1)", () => {
    const h = hueFromIdentity("deadbeef");
    expect(h).toBe(hueFromIdentity("deadbeef"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it("varies across identities", () => {
    expect(hueFromIdentity("aaaa")).not.toBe(hueFromIdentity("bbbb"));
  });
});

describe("parseStoredAvatarSpec", () => {
  it("returns null for malformed JSON (fall back to default body)", () => {
    expect(parseStoredAvatarSpec("{not json")).toBeNull();
    expect(parseStoredAvatarSpec("{}")).toBeNull();
  });

  it("parses a valid spec", () => {
    const json = JSON.stringify(specFromParts([{ dimensions: [1, 1, 1] }]));
    expect(parseStoredAvatarSpec(json)).not.toBeNull();
  });
});

describe("defaultAvatarBuilderSpec", () => {
  it("compiles and fits the avatar clamp after normalization is reasonable", () => {
    const spec = defaultAvatarBuilderSpec();
    expect(spec.parts.length).toBeGreaterThan(0);
    const norm = avatarNormalization(spec);
    expect(norm.scale).toBeGreaterThan(0);
  });
});
