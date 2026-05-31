#!/usr/bin/env node

import { join } from "node:path";

import {
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
  fixturesDir,
  jsonStringArg,
} from "./spacetime-smoke-harness.mjs";

const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-ai-job-smoke",
});

try {
  const alice = harness.loginAs("Alice");
  const bob = harness.loginAs("Bob");

  harness.callAs(alice, "join_world", ["Alice"]);
  harness.callAs(bob, "join_world", ["Bob"]);
  harness.activatePlayers();

  harness.callAs(alice, "request_create_object", [
    "ai-job-smoke-failed",
    "create a pine tree that fails",
  ]);
  harness.activatePlayers();

  expectReducerFailure(
    () =>
      harness.callAs(alice, "request_create_object", [
        "ai-job-smoke-blocked",
        "this should be blocked by the pending job",
      ]),
    "too many pending creation jobs",
    "Pending AI jobs should block duplicate public creates",
  );
  harness.activatePlayers();

  expectReducerFailure(
    () => harness.callAs(bob, "expire_ai_job", ["ai-job-smoke-failed"]),
    "only the job owner or world staff",
    "Other players should not expire someone else's AI job",
  );
  harness.activatePlayers();

  harness.callAs(alice, "fail_ai_job", ["ai-job-smoke-failed", "generation_failed"]);
  harness.activatePlayers();

  const failedOutput = harness.query(
    "SELECT job_id, status, error_code FROM ai_job WHERE job_id = 'ai-job-smoke-failed'",
  );
  expectIncludes(failedOutput, '"failed"', "Failed AI job should be marked failed");
  expectIncludes(failedOutput, '"generation_failed"', "Failed AI job should preserve error code");

  expectReducerFailure(
    () =>
      harness.callAs(alice, "submit_ai_draft", [
        "ai-job-smoke-failed",
        "ai-job-smoke-object-failed",
        jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
        jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
      ]),
    "AI job is not pending",
    "Stale worker responses should not create objects for failed jobs",
  );
  harness.activatePlayers();

  harness.callAs(alice, "request_create_object", [
    "ai-job-smoke-timeout",
    "create a pine tree that times out",
  ]);
  harness.activatePlayers();
  harness.callAs(alice, "expire_ai_job", ["ai-job-smoke-timeout"]);
  harness.activatePlayers();

  const timeoutOutput = harness.query(
    "SELECT job_id, status, error_code FROM ai_job WHERE job_id = 'ai-job-smoke-timeout'",
  );
  expectIncludes(timeoutOutput, '"failed"', "Expired AI job should be marked failed");
  expectIncludes(timeoutOutput, '"timeout"', "Expired AI job should use timeout error code");

  harness.callAs(alice, "request_create_object", [
    "ai-job-smoke-unblocked",
    "create a pine tree after failed jobs",
  ]);
  harness.activatePlayers();

  const unblockedOutput = harness.query(
    "SELECT job_id, status FROM ai_job WHERE job_id = 'ai-job-smoke-unblocked'",
  );
  expectIncludes(unblockedOutput, '"pending"', "Failed jobs should unblock a new create request");

  console.log("ai-job failure smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
