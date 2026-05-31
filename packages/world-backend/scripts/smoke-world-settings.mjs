#!/usr/bin/env node

import { join } from "node:path";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const settingsObjectId = "settings-smoke-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-settings-smoke",
});

try {
  const host = harness.loginAs("Host");
  const player = harness.loginAs("Player");

  harness.callAs(host, "join_world", ["Host"]);
  harness.callAs(player, "join_world", ["Player"]);
  harness.query("UPDATE player_session SET role = 'host' WHERE nickname = 'Host'");
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(host, "update_world_settings", [
        "public",
        "20",
        "10",
        "5",
        "1",
        "true",
        "30",
        "12",
      ]),
    "public worlds cannot enable destructive edits",
    "Public worlds should reject destructive edit settings",
  );
  harness.activatePlayers();

  harness.callAs(host, "update_world_settings", [
    "public",
    "20",
    "2",
    "1",
    "1",
    "false",
    "10",
    "5",
  ]);
  harness.activatePlayers();

  const publicSettingsOutput = harness.query(
    "SELECT visibility, max_live_objects, max_objects_per_player, object_cooldown_seconds, grace_period_seconds FROM world",
  );
  expectIncludes(publicSettingsOutput, '"public"', "World should stay public");
  expectIncludes(publicSettingsOutput, " 2 ", "World should store tuned world object cap");
  expectIncludes(publicSettingsOutput, " 10 ", "World should store tuned cooldown");
  expectIncludes(publicSettingsOutput, " 5 ", "World should store tuned grace period");

  harness.callAs(host, "request_create_object", [
    "settings-smoke-create-job",
    "create one capped pine tree",
  ]);
  harness.activatePlayers();
  harness.callAs(host, "submit_ai_draft", [
    "settings-smoke-create-job",
    settingsObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(host, "release_object", [settingsObjectId]);
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(host, "request_create_object", [
        "settings-smoke-over-cap",
        "create a second capped pine tree",
      ]),
    "player public object cap reached",
    "Tuned public object caps should block additional creates",
  );
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(host, "update_world_settings", [
        "public",
        "1",
        "2",
        "1",
        "1",
        "false",
        "10",
        "5",
      ]),
    "maxPlayers cannot be lower than current active players",
    "World settings should not strand active players",
  );
  harness.activatePlayers();

  harness.callAs(host, "update_world_settings", [
    "private",
    "20",
    "2",
    "1",
    "1",
    "true",
    "10",
    "5",
  ]);
  harness.activatePlayers();

  const privateSettingsOutput = harness.query(
    "SELECT visibility, destructive_edits_enabled FROM world",
  );
  expectIncludes(privateSettingsOutput, '"private"', "Host should switch world to private");
  expectIncludes(privateSettingsOutput, " true ", "Private world should allow destructive edits");

  harness.callAs(player, "delete_object", [settingsObjectId]);
  harness.activatePlayers();
  const deletedOutput = harness.query(
    `SELECT object_id, state FROM world_object WHERE object_id = '${settingsObjectId}'`,
  );
  expectIncludes(deletedOutput, '"deleted"', "Private destructive settings should allow deletion");

  console.log("world-settings smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
