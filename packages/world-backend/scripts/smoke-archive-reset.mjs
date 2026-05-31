#!/usr/bin/env node

import { join } from "node:path";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const archiveObjectId = "archive-smoke-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-archive-smoke",
});

try {
  const host = harness.loginAs("Host");
  const player = harness.loginAs("Player");

  harness.callAs(host, "join_world", ["Host"]);
  harness.callAs(player, "join_world", ["Player"]);
  harness.query("UPDATE player_session SET role = 'host' WHERE nickname = 'Host'");
  harness.activatePlayers();

  harness.callAs(host, "request_create_object", [
    "archive-smoke-create-job",
    "create a pine tree before reset",
  ]);
  harness.activatePlayers();
  harness.callAs(host, "submit_ai_draft", [
    "archive-smoke-create-job",
    archiveObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(host, "release_object", [archiveObjectId]);
  harness.activatePlayers();

  harness.callAs(host, "create_snapshot", ["archive-smoke-snapshot-1", "manual_reset"]);
  harness.activatePlayers();

  const snapshotOutput = harness.query(
    "SELECT snapshot_id, cycle_number, reason FROM world_snapshot",
  );
  expectIncludes(snapshotOutput, '"archive-smoke-snapshot-1"', "Snapshot row should be inserted");
  expectIncludes(snapshotOutput, '"manual_reset"', "Snapshot reason should be preserved");

  const archivedOutput = harness.query(
    "SELECT snapshot_id, source_object_id, state, captured_state FROM snapshot_object",
  );
  expectIncludes(archivedOutput, '"archive-smoke-snapshot-1"', "Snapshot object should reference snapshot");
  expectIncludes(archivedOutput, `"${archiveObjectId}"`, "Snapshot object should preserve source object id");
  expectIncludes(archivedOutput, '"archived"', "Snapshot object should be archived");
  expectIncludes(archivedOutput, '"public"', "Snapshot object should preserve captured live state");

  const liveAfterSnapshot = harness.query(
    `SELECT object_id, state FROM world_object WHERE object_id = '${archiveObjectId}'`,
  );
  expectIncludes(liveAfterSnapshot, '"public"', "Snapshot should not mutate live object state");

  expectReducerFailure(
    () => harness.callAs(player, "reset_world", ["archive-smoke-snapshot-2", "manual_reset"]),
    "only a host or moderator",
    "Regular players should not reset the world",
  );
  harness.activatePlayers();

  harness.callAs(host, "reset_world", ["archive-smoke-snapshot-2", "manual_reset"]);
  harness.activatePlayers();

  const liveAfterReset = harness.query(
    `SELECT object_id, state FROM world_object WHERE object_id = '${archiveObjectId}'`,
  );
  expectIncludes(liveAfterReset, '"deleted"', "Reset should wipe the live editable object");

  const resetSnapshotOutput = harness.query(
    "SELECT snapshot_id, source_object_id, state FROM snapshot_object WHERE snapshot_id = 'archive-smoke-snapshot-2'",
  );
  expectIncludes(resetSnapshotOutput, `"${archiveObjectId}"`, "Reset should capture object before deleting live state");
  expectIncludes(resetSnapshotOutput, '"archived"', "Reset snapshot object should be archived");

  const locksOutput = harness.query("SELECT object_id, lock_type FROM object_lock");
  if (locksOutput.includes(archiveObjectId)) {
    throw new Error("Reset should clear active object locks");
  }

  console.log("archive-reset smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
