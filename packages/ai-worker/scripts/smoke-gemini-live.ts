import assert from "node:assert/strict";

import {
  createGeminiPlanGenerator,
  startAiWorkerServer,
} from "../src/index.ts";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.log("ai-worker Gemini live smoke skipped: GOOGLE_GENERATIVE_AI_API_KEY is not set");
  process.exit(0);
}

const server = await startAiWorkerServer({
  host: "127.0.0.1",
  planGenerator: createGeminiPlanGenerator({
    model: process.env.AI_WORKER_MODEL,
  }),
  port: 0,
  timeoutMs: Number(process.env.AI_WORKER_TIMEOUT_MS ?? 20_000),
});

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${url}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "create",
      source_prompt: "Create a small glowing pine tree for a shared voxel world.",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "completed");
  assert.equal(payload.source_spec.operation, "create");
  assert.equal(payload.builder_spec.operation, "create");
  assert.ok(payload.builder_spec.complexity.part_count > 0);

  console.log("ai-worker Gemini live smoke passed");
  console.log(`url: ${url}`);
  console.log(`object_category: ${payload.source_spec.object_category}`);
  console.log(`object_id_base: ${payload.object_id_base}`);
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
