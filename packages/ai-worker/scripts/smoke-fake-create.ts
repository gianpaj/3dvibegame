import assert from "node:assert/strict";

import {
  createStaticPlanGenerator,
  startAiWorkerServer,
} from "../src/index.ts";

const server = await startAiWorkerServer({
  host: "127.0.0.1",
  planGenerator: createStaticPlanGenerator(),
  port: 0,
});

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${url}/healthz`);
  assert.equal(health.status, 200);

  const response = await fetch(`${url}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "create",
      source_prompt: "Create a pine tree with a soft glow",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "completed");
  assert.equal(payload.source_spec.object_category, "pine_tree");
  assert.ok(payload.builder_spec.complexity.part_count > 0);

  console.log("ai-worker fake create smoke passed");
  console.log(`url: ${url}`);
  console.log(`object_id_base: ${payload.object_id_base}`);
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
