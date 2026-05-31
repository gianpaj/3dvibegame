#!/usr/bin/env node

import { join } from "node:path";

import {
  assert,
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const smokeObjectId = "lock-smoke-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-lock-smoke",
});

try {
  const alice = harness.loginAs("Alice");
  const bob = harness.loginAs("Bob");

  harness.callAs(alice, "join_world", ["Alice"]);
  harness.callAs(bob, "join_world", ["Bob"]);
  harness.activatePlayers();

  const playersOutput = harness.query(
    "SELECT identity, nickname, presence_state FROM player_session",
  );
  const identities = [...new Set(playersOutput.match(/0x[0-9a-f]{64}/g) ?? [])];
  assert(identities.length === 2, "expected two distinct anonymous player identities");
  expectIncludes(playersOutput, '"Alice"', "Alice should be present");
  expectIncludes(playersOutput, '"Bob"', "Bob should be present");

  harness.callAs(alice, "request_create_object", [
    "lock-smoke-create-job",
    "create a pine tree",
  ]);
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(alice, "request_create_object", [
        "lock-smoke-extra-create-job",
        "create a second pine tree too quickly",
      ]),
    "too many pending creation jobs",
    "Alice should not queue a second public create while one is pending",
  );
  harness.activatePlayers();

  harness.callAs(alice, "submit_ai_draft", [
    "lock-smoke-create-job",
    smokeObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();

  harness.callAs(alice, "release_object", [smokeObjectId]);
  harness.activatePlayers();

  harness.callAs(alice, "request_edit_lock", [smokeObjectId, "1"]);
  harness.activatePlayers();

  const lockedOutput = harness.query(
    `SELECT object_id, state, version, lock_owner FROM world_object WHERE object_id = '${smokeObjectId}'`,
  );
  expectIncludes(lockedOutput, '"edit_locked"', "Alice should hold the edit lock");

  expectReducerFailure(
    () => harness.callAs(bob, "request_edit_lock", [smokeObjectId, "1"]),
    "expected public but got edit_locked",
    "Bob should not acquire a second edit lock",
  );
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(bob, "update_locked_transform", [
        smokeObjectId,
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "1",
        "1",
        "1",
      ]),
    "only the lock owner can update locked transform",
    "Bob should not mutate Alice's locked object",
  );
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(bob, "submit_object_edit", [
        smokeObjectId,
        "1",
        jsonStringArg(join(fixturesDir, "pine-tree-edit.voxel-builder.json")),
        jsonStringArg(join(fixturesDir, "pine-tree-edit.builder.json")),
      ]),
    "only the lock owner can submit an edit",
    "Bob should not submit Alice's locked edit",
  );
  harness.activatePlayers();

  harness.callAs(alice, "submit_object_edit", [
    smokeObjectId,
    "1",
    jsonStringArg(join(fixturesDir, "pine-tree-edit.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree-edit.builder.json")),
  ]);

  const editedOutput = harness.query(
    `SELECT object_id, state, version, lock_owner FROM world_object WHERE object_id = '${smokeObjectId}'`,
  );
  expectIncludes(editedOutput, '"cooldown"', "Alice's submitted edit should enter cooldown");
  expectIncludes(editedOutput, " 2 ", "Alice's edit should increment the object version");

  const locksOutput = harness.query("SELECT object_id, lock_type FROM object_lock");
  assert(!locksOutput.includes(smokeObjectId), "submitted edit should clear the active object lock");

  console.log("lock-contention smoke passed");
  console.log(`database: ${harness.database}`);
  console.log(`alice: ${identities[0]}`);
  console.log(`bob:   ${identities[1]}`);
} finally {
  harness.dispose();
}
