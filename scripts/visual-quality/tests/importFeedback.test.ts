import path from "node:path";

import { describe, expect, it } from "vitest";

import { fileJsonReader, validateDataset } from "../src/dataset.ts";
import { readJson } from "../src/files.ts";
import { importFeedbackRows } from "../src/importFeedback.ts";
import { evalsRoot } from "../src/paths.ts";

const specDir = path.join(evalsRoot, "fixtures", "specs");
const builderSpecJson = JSON.stringify(readJson(path.join(specDir, "pine-tree.builder.json")));
const sourceSpecJson = JSON.stringify(readJson(path.join(specDir, "pine-tree.source.json")));

function row(overrides: Record<string, unknown> = {}) {
  return {
    feedback_id: 42,
    world_id: 7,
    object_id: "object_secret_123",
    object_version: 1,
    operation_id: "backend_create_1759999999999_3",
    operation: "create",
    rating: "down",
    source_prompt: "a pine tree",
    source_spec_json: sourceSpecJson,
    builder_spec_json: builderSpecJson,
    model_id: "gemini-2.5-flash",
    prompt_version: "v3",
    player_identity: "c200deadbeefcafe",
    player_nickname: "SneakyFox",
    created_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

describe("importFeedbackRows", () => {
  it("drops player identity, nickname, world/object/operation IDs and timestamps", () => {
    const result = importFeedbackRows([row()], "test");
    const serialized = JSON.stringify(result);
    for (const secret of ["c200deadbeefcafe", "SneakyFox", "object_secret_123", "backend_create_1759999999999_3", "2026-10-01"]) {
      expect(serialized).not.toContain(secret);
    }
    const [sample] = result.manifest.samples;
    expect(sample).toMatchObject({
      prompt: "a pine tree",
      generator: { model_id: "gemini-2.5-flash", prompt_version: "v3" },
      provenance: { kind: "feedback_export", player_rating: "down", privacy_reviewed: false },
    });
  });

  it("produces stable opaque sample IDs", () => {
    const a = importFeedbackRows([row()], "a").manifest.samples[0]!.sample_id;
    const b = importFeedbackRows([row()], "b").manifest.samples[0]!.sample_id;
    expect(a).toBe(b);
    expect(a).toMatch(/^fb-[0-9a-f]{12}$/);
  });

  it("excludes edit records with an explicit reason", () => {
    const result = importFeedbackRows([row({ operation: "edit" })], "test");
    expect(result.manifest.samples).toHaveLength(0);
    expect(result.excluded[0]!.reason).toMatch(/before-spec snapshot/);
  });

  it("excludes rows whose compiled spec isn't JSON", () => {
    const result = importFeedbackRows([row({ builder_spec_json: "{nope" })], "test");
    expect(result.excluded).toEqual([{ row: 0, reason: "builder_spec_json is not valid JSON" }]);
  });

  it("accepts camelCase SDK rows", () => {
    const camel = {
      operation: "create",
      sourcePrompt: "a pine tree",
      builderSpecJson,
      modelId: "m",
      promptVersion: "v1",
      playerNickname: "SneakyFox",
    };
    const result = importFeedbackRows([camel], "test");
    expect(result.manifest.samples).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SneakyFox");
  });

  it("flags prompts that look like personal information", () => {
    const result = importFeedbackRows([row({ source_prompt: "a sign that says email me at bob@example.com" })], "t");
    expect(result.privacy_flags[0]!.matches).toContain("email address");
  });

  it("produces samples that need curation before evaluation", () => {
    const { manifest } = importFeedbackRows([row()], "test");
    const [v] = validateDataset(manifest.samples, fileJsonReader(specDir));
    expect(v!.status === "input_invalid" && v!.issue).toBe("needs_curation");
    expect(v!.status === "input_invalid" && v!.reasons.join(" ")).toMatch(/quantity.*visual_attributes.*personal-information/s);
  });

  it("validates once a human curates the import", () => {
    const { manifest } = importFeedbackRows([row()], "test");
    const curated = {
      ...manifest.samples[0]!,
      quantity: 1,
      visual_attributes_applicable: false,
      prompt_family_id: "tree",
      split: "development",
      provenance: { kind: "feedback_export", player_rating: "down", privacy_reviewed: true },
    };
    const [v] = validateDataset([curated], fileJsonReader(specDir));
    expect(v!.status).toBe("valid");
  });
});
