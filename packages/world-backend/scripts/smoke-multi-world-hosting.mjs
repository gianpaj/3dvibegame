#!/usr/bin/env node

import { join } from "node:path";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const skyObjectId = "sky-garden-object";
const chaosObjectId = "chaos-room-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-multi-world-smoke",
});

try {
  const skyHost = harness.loginAs("Sky Host");
  const chaosHost = harness.loginAs("Chaos Host");
  const visitor = harness.loginAs("Visitor");
  const defaultVisitor = harness.loginAs("Default Visitor");

  harness.callAs(skyHost, "create_world", ["Sky Garden", "public", "Sky Host"]);
  harness.callAs(chaosHost, "create_world", ["Chaos Room", "private", "Chaos Host"]);
  harness.activatePlayers();

  const worldsOutput = harness.query("SELECT world_id, name, visibility FROM world");
  expectIncludes(worldsOutput, '"Sky Garden"', "Sky host should create a public world");
  expectIncludes(worldsOutput, '"Chaos Room"', "Chaos host should create a private world");
  expectIncludes(worldsOutput, '"private"', "Created private world visibility should persist");

  const skyWorldId = worldIdForName("Sky Garden");
  const chaosWorldId = worldIdForName("Chaos Room");
  const defaultWorldId = worldIdForName("Vibe Test Room");
  if (skyWorldId === chaosWorldId) {
    throw new Error("Created worlds should have distinct ids");
  }
  if (defaultWorldId === skyWorldId || defaultWorldId === chaosWorldId) {
    throw new Error("Default world should stay distinct from hosted worlds");
  }

  const skyHostOutput = harness.query(
    "SELECT world_id, role FROM player_session WHERE nickname = 'Sky Host'",
  );
  expectIncludes(skyHostOutput, ` ${skyWorldId} `, "Sky host should enter Sky Garden");
  expectIncludes(skyHostOutput, '"host"', "Sky creator should enter their new world as host");

  const chaosHostOutput = harness.query(
    "SELECT world_id, role FROM player_session WHERE nickname = 'Chaos Host'",
  );
  expectIncludes(chaosHostOutput, ` ${chaosWorldId} `, "Chaos host should enter Chaos Room");
  expectIncludes(chaosHostOutput, '"host"', "Chaos creator should enter their new world as host");

  harness.callAs(visitor, "join_world_by_id", [skyWorldId, "Visitor"]);
  harness.activatePlayers();
  const visitorOutput = harness.query(
    "SELECT nickname, world_id, role FROM player_session WHERE nickname = 'Visitor'",
  );
  expectIncludes(
    visitorOutput,
    ` ${skyWorldId} `,
    "Visitor should join the selected Sky Garden world",
  );
  expectIncludes(visitorOutput, '"player"', "Selected-world join should use player role");

  harness.callAs(defaultVisitor, "join_world", ["Default Visitor"]);
  harness.activatePlayers();
  const defaultVisitorOutput = harness.query(
    "SELECT nickname, world_id, role FROM player_session WHERE nickname = 'Default Visitor'",
  );
  expectIncludes(
    defaultVisitorOutput,
    ` ${defaultWorldId} `,
    "Default join should still use the seeded development world",
  );
  expectIncludes(defaultVisitorOutput, '"player"', "Default join should use player role");

  expectReducerFailure(
    () =>
      harness.callAs(visitor, "update_world_settings", [
        "public",
        "20",
        "120",
        "12",
        "1",
        "false",
        "30",
        "12",
      ]),
    "only a host or moderator",
    "Visitors should not manage selected-world settings",
  );
  harness.activatePlayers();

  createAndReleaseObject({
    objectId: skyObjectId,
    player: skyHost,
    jobId: "sky-garden-create-job",
    prompt: "create a pine tree in Sky Garden",
  });
  createAndReleaseObject({
    objectId: chaosObjectId,
    player: chaosHost,
    jobId: "chaos-room-create-job",
    prompt: "create a pine tree in Chaos Room",
  });

  const objectOutput = harness.query("SELECT object_id, world_id, state FROM world_object");
  expectIncludes(objectOutput, `"${skyObjectId}"`, "Sky world object should exist");
  expectIncludes(objectOutput, `"${chaosObjectId}"`, "Chaos world object should exist");

  const skyObjectWorldOutput = harness.query(
    `SELECT world_id, state FROM world_object WHERE object_id = '${skyObjectId}'`,
  );
  expectIncludes(skyObjectWorldOutput, ` ${skyWorldId} `, "Sky object should stay in Sky Garden");
  expectIncludes(skyObjectWorldOutput, '"public"', "Sky object should be released");

  const chaosObjectWorldOutput = harness.query(
    `SELECT world_id, state FROM world_object WHERE object_id = '${chaosObjectId}'`,
  );
  expectIncludes(
    chaosObjectWorldOutput,
    ` ${chaosWorldId} `,
    "Chaos object should stay in Chaos Room",
  );
  expectIncludes(chaosObjectWorldOutput, '"public"', "Chaos object should be released");

  const skyOnlyObjects = harness.query(
    `SELECT object_id FROM world_object WHERE world_id = ${skyWorldId}`,
  );
  expectIncludes(skyOnlyObjects, `"${skyObjectId}"`, "Sky Garden query should include Sky object");
  if (skyOnlyObjects.includes(chaosObjectId)) {
    throw new Error("Sky Garden query should not include Chaos object");
  }

  expectReducerFailure(
    () => harness.callAs(visitor, "request_edit_lock", [chaosObjectId, "1"]),
    "object is not in the active player world",
    "A player in one hosted world should not edit objects from another hosted world",
  );
  harness.activatePlayers();

  console.log("multi-world hosting smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}

function createAndReleaseObject({ player, jobId, objectId, prompt }) {
  harness.callAs(player, "request_create_object", [jobId, prompt]);
  harness.activatePlayers();
  harness.callAs(player, "submit_ai_draft", [
    jobId,
    objectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(player, "release_object", [objectId]);
  harness.activatePlayers();
}

function worldIdForName(name) {
  const output = harness.query(`SELECT world_id FROM world WHERE name = '${name}'`);
  const match = output.match(/\n\s*(\d+)\s*(?:\||$)/);
  if (!match) {
    throw new Error(`Could not read world id for ${name}\nOutput:\n${output}`);
  }
  return match[1];
}
