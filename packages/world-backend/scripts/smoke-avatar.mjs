#!/usr/bin/env node

import {
  assert,
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
} from "./spacetime-smoke-harness.mjs";

// A small standing body that fits the 2x3x2 avatar clamp. The voxel core is opaque
// to the reducer (it only checks that it parses); the builder spec must have a
// non-empty parts array whose combined AABB fits the clamp.
const voxelCore = JSON.stringify({
  object_category: "avatar",
  size_tier: "medium",
  operations: [{ op_id: "body", kind: "add_box" }],
});

function builderSpec({ tall = false } = {}) {
  return JSON.stringify({
    parts: [
      {
        part_id: "legs",
        primitive: "box",
        dimensions: [1.4, tall ? 4 : 0.9, 1.4],
        local_position: [0, 0.45, 0],
      },
      {
        part_id: "torso",
        primitive: "box",
        dimensions: [1.6, 1.2, 1.0],
        local_position: [0, 1.5, 0],
      },
    ],
  });
}

// `spacetime call` parses each positional arg as a JSON value, so a String reducer
// arg must be a JSON-quoted string (the whole spec JSON becomes one quoted string).
const arg = (value) => JSON.stringify(value);

const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-avatar-smoke",
});

try {
  const alice = harness.loginAs("Alice");
  const bob = harness.loginAs("Bob");

  harness.callAs(alice, "join_world", ["Alice"]);
  harness.callAs(bob, "join_world", ["Bob"]);
  harness.activatePlayers();

  // 1. Upsert: first set_avatar_spec inserts a version-1 row.
  harness.callAs(alice, "set_avatar_spec", [arg(voxelCore), arg(builderSpec())]);
  const afterInsert = harness.query("SELECT version FROM player_avatar");
  expectIncludes(afterInsert, "1", "first avatar set should create a version-1 row");

  // 2. Rate limit: a second update < 10 s later is rejected.
  harness.activatePlayers();
  expectReducerFailure(
    () =>
      harness.callAs(alice, "set_avatar_spec", [arg(voxelCore), arg(builderSpec())]),
    "updated too recently",
    "rapid avatar updates should be rate limited",
  );

  // 3. Size rejection: a body taller than the 3-unit clamp is rejected.
  harness.activatePlayers();
  expectReducerFailure(
    () =>
      harness.callAs(bob, "set_avatar_spec", [
        arg(voxelCore),
        arg(builderSpec({ tall: true })),
      ]),
    "size clamp",
    "oversized avatars should be rejected",
  );

  // 4. Malformed JSON is rejected.
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(bob, "set_avatar_spec", [arg("{nope"), arg(builderSpec())]),
    "malformed",
    "malformed avatar voxel core should be rejected",
  );

  // 5. Only one row per identity (upsert, not insert).
  const rowCount = harness.query("SELECT identity FROM player_avatar");
  assert(
    (rowCount.match(/0x|c2_/g) ?? []).length <= 2,
    "player_avatar should hold at most one row per identity",
  );

  console.log("avatar smoke checks passed");
} finally {
  harness.dispose();
}
