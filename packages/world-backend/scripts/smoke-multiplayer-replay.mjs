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

const playerCount = readPlayerCount();
const replayObjectId = "replay-smoke-object";
const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-replay-smoke",
});

try {
  const players = Array.from({ length: playerCount }, (_, index) =>
    harness.loginAs(`Player ${index + 1}`, `player-${index + 1}`),
  );

  players.forEach((player, index) => {
    harness.callAs(player, "join_world", [`Player ${index + 1}`]);
  });
  harness.activatePlayers();

  const joinedOutput = harness.query(
    "SELECT identity, nickname, presence_state FROM player_session",
  );
  const identities = [...new Set(joinedOutput.match(/0x[0-9a-f]{64}/g) ?? [])];
  assert(
    identities.length === playerCount,
    `expected ${playerCount} distinct anonymous player identities`,
  );
  expectIncludes(joinedOutput, '"Player 1"', "Player 1 should be present");
  expectIncludes(joinedOutput, `"Player ${playerCount}"`, "Last player should be present");

  players.forEach((player, index) => {
    harness.activatePlayers();
    harness.callAs(player, "move_player", [
      String(index * 1.25),
      "0",
      String(index * -0.75),
      String(index * 0.1),
      "0",
    ]);
  });
  harness.activatePlayers();

  const movedOutput = harness.query(
    "SELECT nickname, presence_state, position_x, position_z FROM player_session",
  );
  expectIncludes(movedOutput, "1.25", "Movement should update player position rows");
  expectIncludes(movedOutput, "-0.75", "Movement should preserve signed Z positions");

  harness.callAs(players[1], "join_world", ["Player 2 Rejoined"]);
  harness.activatePlayers();
  const rejoinedOutput = harness.query(
    "SELECT nickname, presence_state FROM player_session",
  );
  expectIncludes(rejoinedOutput, '"Player 2 Rejoined"', "Reconnect should refresh nickname state");

  harness.callAs(players[0], "request_create_object", [
    "replay-smoke-create-job",
    "create a pine tree for replay coverage",
  ]);
  harness.activatePlayers();
  harness.callAs(players[0], "submit_ai_draft", [
    "replay-smoke-create-job",
    replayObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(players[0], "release_object", [replayObjectId]);
  harness.activatePlayers();

  const objectOutput = harness.query(
    `SELECT object_id, state, version FROM world_object WHERE object_id = '${replayObjectId}'`,
  );
  expectIncludes(objectOutput, '"public"', "Replay object should be visible as a public delta");
  expectIncludes(objectOutput, " 1 ", "Replay object should start at version 1");

  harness.callAs(players[1], "request_edit_lock", [replayObjectId, "1"]);
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(players[2], "request_edit_lock", [replayObjectId, "1"]),
    "expected public but got edit_locked",
    "A second replay player should not acquire the active edit lock",
  );
  harness.activatePlayers();
  harness.callAs(players[1], "cancel_edit", [replayObjectId]);
  harness.activatePlayers();

  const unlockedOutput = harness.query(
    `SELECT object_id, state, version FROM world_object WHERE object_id = '${replayObjectId}'`,
  );
  expectIncludes(unlockedOutput, '"public"', "Canceled replay lock should return object to public");

  console.log("multiplayer replay smoke passed");
  console.log(`database: ${harness.database}`);
  console.log(`players: ${playerCount}`);
  console.log(`identities: ${identities.length}`);
} finally {
  harness.dispose();
}

function readPlayerCount() {
  const raw = process.env.VIBE_WORLD_SMOKE_PLAYERS;
  if (!raw) return 4;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 3 || parsed > 12) {
    throw new Error("VIBE_WORLD_SMOKE_PLAYERS must be an integer from 3 to 12");
  }
  return parsed;
}
