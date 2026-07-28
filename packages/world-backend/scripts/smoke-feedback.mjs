#!/usr/bin/env node

import {
  assert,
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
} from "./spacetime-smoke-harness.mjs";

const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-feedback-smoke",
});

// The reducer only checks each spec string is non-empty and within the length cap — it
// does not parse them — so small placeholder strings are enough to exercise the flow.
const sourceSpec = "source-spec";
const builderSpec = "builder-spec";
const model = "gemini-2.5-flash";
const promptVersion = "v1";

// One full create submission: operationId, objectId, version, operation, rating, prompt,
// sourceSpecJson, builderSpecJson, modelId, promptVersion.
const createArgs = (operationId, rating, overrides = {}) => [
  operationId,
  overrides.objectId ?? "obj-create-1",
  overrides.version ?? "1",
  overrides.operation ?? "create",
  rating,
  overrides.prompt ?? "a small pine tree",
  overrides.sourceSpecJson ?? sourceSpec,
  overrides.builderSpecJson ?? builderSpec,
  model,
  promptVersion,
];

try {
  const alice = harness.loginAs("Alice");
  const carol = harness.loginAs("Carol"); // logs in but never joins the world

  harness.callAs(alice, "join_world", ["Alice"]);
  harness.activatePlayers();

  // 👍 on a create.
  harness.callAs(alice, "submit_object_feedback", createArgs("op-create-1", "up"));
  harness.activatePlayers();

  // 👎 on an edit.
  harness.callAs(
    alice,
    "submit_object_feedback",
    createArgs("op-edit-1", "down", { operation: "edit", version: "2" }),
  );

  const stored = harness.query(
    "SELECT operation_id, operation, rating, model_id, prompt_version, player_nickname FROM object_feedback",
  );
  expectIncludes(stored, '"op-create-1"', "create feedback should be stored");
  expectIncludes(stored, '"up"', "the 👍 rating should be stored");
  expectIncludes(stored, '"op-edit-1"', "edit feedback should be stored");
  expectIncludes(stored, '"down"', "the 👎 rating should be stored");
  expectIncludes(stored, '"gemini-2.5-flash"', "the model id snapshot should be stored");
  expectIncludes(stored, '"v1"', "the prompt version snapshot should be stored");
  expectIncludes(stored, '"Alice"', "the rater nickname should be denormalised");

  // Validation: bad rating.
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(alice, "submit_object_feedback", createArgs("op-bad-rating", "meh")),
    "feedback rating must be up or down",
    "an unsupported rating should be rejected",
  );

  // Validation: bad operation.
  harness.activatePlayers();
  expectReducerFailure(
    () =>
      harness.callAs(
        alice,
        "submit_object_feedback",
        createArgs("op-bad-op", "up", { operation: "remix" }),
      ),
    "feedback operation must be create or edit",
    "an unsupported operation should be rejected",
  );

  // Validation: empty operationId.
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(alice, "submit_object_feedback", createArgs("   ", "up")),
    "operationId is required",
    "a blank operationId should be rejected",
  );

  // Validation: over-long spec JSON (cap is 16_000).
  harness.activatePlayers();
  expectReducerFailure(
    () =>
      harness.callAs(
        alice,
        "submit_object_feedback",
        createArgs("op-too-long", "up", { sourceSpecJson: "x".repeat(16_001) }),
      ),
    "source spec JSON must be 16000 characters or fewer",
    "an over-long source spec should be rejected",
  );

  // Submit-once: a second rating for the same operationId is rejected (no upsert).
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(alice, "submit_object_feedback", createArgs("op-create-1", "down")),
    "feedback already submitted for this operation",
    "resubmitting for the same operation should be rejected",
  );

  // …and the original create row is untouched (still 👍, still one row for it).
  const afterResubmit = harness.query(
    "SELECT rating FROM object_feedback WHERE operation_id = 'op-create-1'",
  );
  expectIncludes(afterResubmit, '"up"', "the original rating should survive a rejected resubmit");
  assert(
    !afterResubmit.includes('"down"'),
    "a rejected resubmit must not overwrite the original rating",
  );

  // Authorization: a logged-in identity that never joined cannot submit feedback.
  expectReducerFailure(
    () => harness.callAs(carol, "submit_object_feedback", createArgs("op-sneaky", "up")),
    "player has not joined a world",
    "non-joined identities should not be able to submit feedback",
  );

  const finalRows = harness.query("SELECT operation_id FROM object_feedback");
  assert(!finalRows.includes('"op-sneaky"'), "rejected submissions should not persist rows");
  assert(!finalRows.includes('"op-bad-rating"'), "rejected validations should not persist rows");

  console.log("feedback smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
