import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { test } from "node:test";

import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";
import {
  buildCreateResponse,
  createAiWorkerHandler,
  createStaticPlanGenerator,
} from "../src/index.ts";

test("health check and CORS preflight are handled", async () => {
  const handler = createAiWorkerHandler({
    allowedOrigin: "http://127.0.0.1:5173",
    planGenerator: createStaticPlanGenerator(),
  });

  const server = await listenOnRandomPort(handler);
  try {
    const origin = "http://127.0.0.1:5173";
    const health = await fetch(`${server.url}/healthz`, { headers: { origin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await health.json(), { ok: true, status: "ok" });

    const preflight = await fetch(`${server.url}/generate`, {
      method: "OPTIONS",
      headers: { origin },
    });
    assert.equal(preflight.status, 204);
  } finally {
    await server.close();
  }
});

test("create request returns source and builder specs", async () => {
  const server = await startTestWorker();
  try {
    const response = await postGenerate(server.url, {
      operation: "create",
      source_prompt: "Create a pine tree with a soft glow",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "completed");
    assert.equal(payload.source_spec.operation, "create");
    assert.equal(payload.source_spec.object_category, "pine_tree");
    assert.equal(payload.builder_spec.operation, "create");
    assert.equal(payload.builder_spec.object_category, "pine_tree");
    assert.ok(payload.builder_spec.complexity.part_count > 0);
  } finally {
    await server.close();
  }
});

test("compile request turns a pre-computed plan into a builder spec", async () => {
  const server = await startTestWorker();
  try {
    const response = await fetch(`${server.url}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "create",
        source_prompt: "Create a tall palm tree",
        plan: {
          object_category: "palm_tree",
          size_tier: "large",
          shape: "tree",
          palette: "forest",
          style_tags: ["tropical", "tall"],
          behaviors: [],
          key_features: ["tall trunk", "fan leaves"],
        },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "completed");
    assert.equal(payload.source_spec.object_category, "palm_tree");
    assert.equal(payload.builder_spec.object_category, "palm_tree");
    assert.ok(payload.builder_spec.complexity.part_count > 0);
  } finally {
    await server.close();
  }
});

test("compile request rejects an invalid plan with a validation error", async () => {
  const server = await startTestWorker();
  try {
    const response = await fetch(`${server.url}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "create",
        source_prompt: "Create a tall palm tree",
        plan: { object_category: "palm_tree", shape: "tree" },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error_code, "validation_failed");
  } finally {
    await server.close();
  }
});

test("deterministic create specs are grounded and visible at runtime scale", () => {
  const payload = buildCreateResponse(
    {
      operation: "create",
      source_prompt: "Create a mossy forest guardian with a glowing chest rune",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    },
    {
      object_category: "guardian",
      size_tier: "medium",
      shape: "creature",
      palette: "forest",
      style_tags: ["mossy", "forest", "guardian"],
      behaviors: ["idle"],
      key_features: ["broad shoulders", "glowing chest rune"],
    },
  );

  const builderSpec = payload.builder_spec as BuilderSpec;
  const bounds = builderBounds(builderSpec);
  assert.ok(bounds.minY >= -Number.EPSILON, `expected grounded spec, got minY ${bounds.minY}`);
  assert.ok(bounds.height >= 1.5, `expected visible object height, got ${bounds.height}`);
  assert.deepEqual(
    [...new Set(builderSpec.parts.map((part) => part.material))].sort(),
    ["moss_stone", "neon", "wood"],
  );
});

test("refine and malformed create requests fail with worker error codes", async () => {
  const server = await startTestWorker();
  try {
    const refine = await postGenerate(server.url, {
      operation: "refine",
      source_prompt: "make it brighter",
      target_object_id: "tree",
      base_object_version: 1,
      object_context: null,
    });
    assert.equal(refine.status, 400);
    assert.equal((await refine.json()).error_code, "unsupported_request");

    const invalid = await postGenerate(server.url, {
      operation: "create",
      source_prompt: "",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error_code, "validation_failed");
  } finally {
    await server.close();
  }
});

async function startTestWorker() {
  return listenOnRandomPort(
    createAiWorkerHandler({
      planGenerator: createStaticPlanGenerator(),
    }),
  );
}

async function listenOnRandomPort(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    url: `http://127.0.0.1:${address.port}`,
  };
}

function postGenerate(url: string, body: unknown) {
  return fetch(`${url}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function builderBounds(spec: BuilderSpec) {
  let minY = Infinity;
  let maxY = -Infinity;

  for (const part of spec.parts) {
    const centerY = part.local_position?.[1] ?? 0;
    const height = part.dimensions[1];
    minY = Math.min(minY, centerY - height / 2);
    maxY = Math.max(maxY, centerY + height / 2);
  }

  return { minY, maxY, height: maxY - minY };
}
