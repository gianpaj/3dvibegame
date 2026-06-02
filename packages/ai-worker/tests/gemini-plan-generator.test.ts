import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLanguageModelV3 } from "ai/test";

import {
  buildCreateResponse,
  createGeminiPlanGenerator,
  type CreatePlan,
} from "../src/index.ts";

const plan: CreatePlan = {
  object_category: "pine_tree",
  size_tier: "medium",
  shape: "tree",
  palette: "forest",
  style_tags: ["forest", "chunky"],
  behaviors: [],
  key_features: ["blocky trunk", "layered canopy"],
};

function mockModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

test("gemini plan generator parses the model output into a create plan", async () => {
  const generator = createGeminiPlanGenerator({
    languageModel: mockModel(JSON.stringify(plan)),
  });

  const result = await generator.generateCreatePlan({ sourcePrompt: "a pine tree" });

  assert.equal(result.plan.object_category, "pine_tree");
  assert.equal(result.plan.shape, "tree");
});

test("mocked plan compiles to a builder spec via buildCreateResponse", async () => {
  const generator = createGeminiPlanGenerator({
    languageModel: mockModel(JSON.stringify(plan)),
  });
  const { plan: parsed } = await generator.generateCreatePlan({ sourcePrompt: "a pine tree" });

  const response = buildCreateResponse(
    {
      operation: "create",
      source_prompt: "a pine tree",
      target_object_id: null,
      base_object_version: null,
      object_context: null,
    },
    parsed,
  );

  assert.equal(response.status, "completed");
  assert.equal((response.builder_spec as { object_category: string }).object_category, "pine_tree");
  assert.ok(
    (response.builder_spec as { complexity: { part_count: number } }).complexity.part_count > 0,
  );
});
