#!/usr/bin/env node

import {
  assert,
  createPublishedSmokeHarness,
  expectIncludes,
  expectReducerFailure,
} from "./spacetime-smoke-harness.mjs";

const harness = await createPublishedSmokeHarness({
  dbPrefix: "vibe-world-chat-smoke",
});

try {
  const alice = harness.loginAs("Alice");
  const bob = harness.loginAs("Bob");
  const carol = harness.loginAs("Carol"); // logs in but never joins the world

  harness.callAs(alice, "join_world", ["Alice"]);
  harness.callAs(bob, "join_world", ["Bob"]);
  harness.activatePlayers();

  // Each `spacetime call` disconnects afterward, which marks the caller inactive, so
  // re-activate before every send that needs an active presence.
  harness.callAs(alice, "send_chat_message", ["hello bob"]);
  harness.activatePlayers();
  harness.callAs(bob, "send_chat_message", ["hi alice"]);

  // SpacetimeDB SQL doesn't support ORDER BY / aggregates here, so assert on the
  // raw rows directly.
  const chatOutput = harness.query("SELECT sender_nickname, body FROM chat_message");
  expectIncludes(chatOutput, '"Alice"', "Alice's message should be stored");
  expectIncludes(chatOutput, '"hello bob"', "Alice's body should be stored");
  expectIncludes(chatOutput, '"Bob"', "Bob's message should be stored");
  expectIncludes(chatOutput, '"hi alice"', "Bob's body should be stored");

  // Validation: empty body.
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(alice, "send_chat_message", ["   "]),
    "chat message is empty",
    "blank messages should be rejected",
  );

  // Validation: over-length body (cap is 280).
  harness.activatePlayers();
  expectReducerFailure(
    () => harness.callAs(alice, "send_chat_message", ["a".repeat(281)]),
    "chat message is too long",
    "over-length messages should be rejected",
  );

  // Authorization: a logged-in identity that never joined cannot chat.
  expectReducerFailure(
    () => harness.callAs(carol, "send_chat_message", ["sneaking in"]),
    "player has not joined a world",
    "non-joined identities should not be able to chat",
  );

  // The rejected sends must not have persisted anything.
  const finalOutput = harness.query("SELECT sender_nickname, body FROM chat_message");
  assert(!finalOutput.includes("sneaking in"), "rejected sends should not persist messages");
  assert(!finalOutput.includes('"Carol"'), "non-joined sender should never appear in chat");

  console.log("chat smoke passed");
  console.log(`database: ${harness.database}`);
} finally {
  harness.dispose();
}
