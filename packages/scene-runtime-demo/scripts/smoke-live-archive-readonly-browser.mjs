#!/usr/bin/env node

import { join } from "node:path";

import {
  expectIncludes,
  fixturesDir,
  jsonStringArg,
} from "../../world-backend/scripts/spacetime-smoke-harness.mjs";
import {
  runLiveDemoBrowserSmoke,
  waitForLiveBackendHud,
} from "./browser-smoke-harness.mjs";

const archiveObjectId = "browser-archive-object";
const snapshotId = "browser-archive-reset-1";

await runLiveDemoBrowserSmoke({
  dbPrefix: "vibe-world-live-archive-browser",
  nickname: "Archive Browser",
  setupBackend: seedArchivedWorld,
  async run({ harness, page }) {
    await waitForLiveBackendHud(page);

    const archiveUi = await page.waitForExpression(
      `(() => {
        const shell = document.querySelector('[data-role="hud-shell"]');
        const stage = document.querySelector('[data-role="stage-pill"]');
        const room = document.querySelector('[data-role="room-subtitle"]');
        const actionDock = document.querySelector('[data-role="action-dock"]');
        const hasActionButton = Boolean(
          document.querySelector('[data-object-lifecycle-action]') ||
            document.querySelector('[data-refine]') ||
            document.querySelector('[data-prompt]'),
        );
        const actionText = actionDock?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        if (
          shell?.dataset.multiplayer !== "live" ||
          stage?.dataset.workflow !== "released" ||
          !room?.textContent?.includes("archive #1 - 1 frozen") ||
          !actionText.includes("Archive") ||
          !actionText.includes("archived read-only") ||
          hasActionButton
        ) {
          return null;
        }
        return {
          actionText,
          roomText: room.textContent,
          workflow: stage.dataset.workflow,
        };
      })()`,
      "archive read-only HUD state",
      20_000,
    );

    page.assertNoBrowserErrors();

    const liveRows = harness.query(
      `SELECT object_id, state FROM world_object WHERE object_id = '${archiveObjectId}'`,
    );
    expectIncludes(liveRows, '"deleted"', "Archive browser setup should delete live object");
    const archivedRows = harness.query(
      `SELECT snapshot_id, source_object_id, state, captured_state FROM snapshot_object WHERE snapshot_id = '${snapshotId}'`,
    );
    expectIncludes(archivedRows, `"${archiveObjectId}"`, "Archive row should preserve source object id");
    expectIncludes(archivedRows, '"archived"', "Archive row should be read-only archived state");
    expectIncludes(archivedRows, '"public"', "Archive row should retain captured public state");

    console.log("live archive read-only browser smoke passed");
    console.log(`database: ${harness.database}`);
    console.log(`room: ${archiveUi.roomText}`);
    console.log(`archive_action: ${archiveUi.actionText}`);
  },
});

function seedArchivedWorld(harness) {
  const host = harness.loginAs("Archive Host");

  harness.callAs(host, "join_world", ["Archive Host"]);
  harness.query("UPDATE player_session SET role = 'host' WHERE nickname = 'Archive Host'");
  harness.activatePlayers();

  harness.callAs(host, "request_create_object", [
    "browser-archive-create-job",
    "create a pine tree before archive browser smoke",
  ]);
  harness.activatePlayers();
  harness.callAs(host, "submit_ai_draft", [
    "browser-archive-create-job",
    archiveObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  harness.activatePlayers();
  harness.callAs(host, "release_object", [archiveObjectId]);
  harness.activatePlayers();
  harness.callAs(host, "reset_world", [snapshotId, "manual_reset"]);
  harness.activatePlayers();
}
