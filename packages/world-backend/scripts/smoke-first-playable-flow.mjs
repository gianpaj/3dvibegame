#!/usr/bin/env node

import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const playableObjectId = "first-playable-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-first-playable-smoke",
});

try {
  const creator = harness.loginAs("Creator");
  const remixer = harness.loginAs("Remixer");

  harness.callAs(creator, "join_world", ["Creator"]);
  harness.callAs(remixer, "join_world", ["Remixer"]);
  harness.activatePlayers();

  const promptStartedAt = performance.now();
  harness.callAs(creator, "request_create_object", [
    "first-playable-create-job",
    "vibecode a pine tree into the shared world",
  ]);
  harness.activatePlayers();
  harness.callAs(creator, "submit_ai_draft", [
    "first-playable-create-job",
    playableObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  const promptToDraftMs = Math.round(performance.now() - promptStartedAt);
  harness.activatePlayers();

  const draftOutput = harness.query(
    `SELECT object_id, state, version, grace_owner FROM world_object WHERE object_id = '${playableObjectId}'`,
  );
  expectIncludes(draftOutput, '"grace"', "Prompt submission should create a grace draft");
  expectIncludes(draftOutput, " 1 ", "Draft should start at version 1");

  harness.callAs(creator, "update_draft_transform", [
    playableObjectId,
    "0.5",
    "0",
    "-0.25",
    "0",
    "0.2",
    "0",
    "1.1",
    "1.1",
    "1.1",
  ]);
  harness.activatePlayers();
  harness.callAs(creator, "release_object", [playableObjectId]);
  harness.activatePlayers();

  const releasedOutput = harness.query(
    `SELECT object_id, state, version, position_x, position_z FROM world_object WHERE object_id = '${playableObjectId}'`,
  );
  expectIncludes(releasedOutput, '"public"', "Creator release should publish the object");
  expectIncludes(releasedOutput, "0.5", "Draft transform should persist through release");
  expectIncludes(releasedOutput, "-0.25", "Draft signed Z transform should persist");

  harness.callAs(remixer, "request_edit_lock", [playableObjectId, "1"]);
  harness.activatePlayers();
  harness.callAs(remixer, "submit_object_edit", [
    playableObjectId,
    "1",
    jsonStringArg(join(fixturesDir, "pine-tree-edit.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree-edit.builder.json")),
  ]);
  harness.activatePlayers();

  const cooldownOutput = harness.query(
    `SELECT object_id, state, version FROM world_object WHERE object_id = '${playableObjectId}'`,
  );
  expectIncludes(cooldownOutput, '"cooldown"', "Accepted remix should enter cooldown");
  expectIncludes(cooldownOutput, " 2 ", "Accepted remix should increment to version 2");

  expectReducerFailure(
    () => harness.callAs(creator, "delete_object", [playableObjectId]),
    "expected public but got cooldown",
    "Cooldown should block destructive actions until the object returns public",
  );
  harness.activatePlayers();

  harness.callAs(remixer, "expire_cooldown", [playableObjectId]);
  harness.activatePlayers();

  const finalOutput = harness.query(
    `SELECT object_id, state, version FROM world_object WHERE object_id = '${playableObjectId}'`,
  );
  expectIncludes(finalOutput, '"public"', "Cooldown expiry should return the remix to public");
  expectIncludes(finalOutput, " 2 ", "Final public object should keep version 2");

  // The shared room is now private + destructive, so the creator can delete their
  // released object.
  harness.callAs(creator, "delete_object", [playableObjectId]);
  harness.activatePlayers();

  const deletedOutput = harness.query(
    `SELECT object_id, state FROM world_object WHERE object_id = '${playableObjectId}'`,
  );
  expectIncludes(deletedOutput, '"deleted"', "Creator can delete their released object in the destructive room");

  console.log("first-playable flow smoke passed");
  console.log(`database: ${harness.database}`);
  console.log(`prompt_to_draft_ms: ${promptToDraftMs}`);
} finally {
  harness.dispose();
}
