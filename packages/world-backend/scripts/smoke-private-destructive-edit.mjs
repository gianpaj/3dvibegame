#!/usr/bin/env node

import { join } from "node:path";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const destructiveObjectId = "private-destructive-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-private-destructive-smoke",
});

try {
  const host = harness.loginAs("Host");
  const player = harness.loginAs("Player");

  harness.callAs(host, "join_world", ["Host"]);
  harness.callAs(player, "join_world", ["Player"]);
  harness.query("UPDATE player_session SET role = 'host' WHERE nickname = 'Host'");
  harness.activatePlayers();

  harness.callAs(host, "request_create_object", [
    "private-destructive-create-job",
    "create a pine tree that a private-room player can delete",
  ]);
  harness.activatePlayers();
  harness.callAs(host, "submit_ai_draft", [
    "private-destructive-create-job",
    destructiveObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(host, "release_object", [destructiveObjectId]);
  harness.activatePlayers();

  // The default room is now private + destructive, so switch it to public first to
  // verify public rooms reject deletion of released objects.
  harness.callAs(host, "update_world_settings", [
    "public",
    "20",
    "50",
    "10",
    "1",
    "false",
    "30",
    "12",
  ]);
  harness.activatePlayers();

  expectReducerFailure(
    () => harness.callAs(player, "delete_object", [destructiveObjectId]),
    "cannot delete released objects in this world",
    "Public rooms should reject destructive delete by another player",
  );
  harness.activatePlayers();

  harness.callAs(host, "update_world_settings", [
    "private",
    "20",
    "50",
    "10",
    "1",
    "false",
    "30",
    "12",
  ]);
  harness.activatePlayers();

  expectReducerFailure(
    () => harness.callAs(player, "delete_object", [destructiveObjectId]),
    "cannot delete released objects in this world",
    "Private rooms should still reject delete until destructive edits are enabled",
  );
  harness.activatePlayers();

  harness.callAs(host, "update_world_settings", [
    "private",
    "20",
    "50",
    "10",
    "1",
    "true",
    "30",
    "12",
  ]);
  harness.activatePlayers();

  // Within 90s of creation, a non-creator cannot delete the object.
  expectReducerFailure(
    () => harness.callAs(player, "delete_object", [destructiveObjectId]),
    "object is protected from deletion for 90 seconds after creation",
    "Non-creator should not delete a freshly created object within 90s",
  );
  harness.activatePlayers();

  // The creator can delete their own object immediately.
  harness.callAs(host, "delete_object", [destructiveObjectId]);
  harness.activatePlayers();

  const deletedOutput = harness.query(
    `SELECT object_id, state FROM world_object WHERE object_id = '${destructiveObjectId}'`,
  );
  expectIncludes(deletedOutput, '"deleted"', "Creator can delete their object in the private destructive room");

  console.log("private destructive edit smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
