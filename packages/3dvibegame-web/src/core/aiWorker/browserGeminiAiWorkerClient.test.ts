import { describe, expect, it } from "vitest";
import type { BuilderSpec, VoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { createBrowserGeminiAiWorkerClient } from "@/core/aiWorker/browserGeminiAiWorkerClient";
import { geminiResponse, redTreeCore, sourceSpecJsonFor, treeCore } from "@/test/fakeGemini";

// Local-compile client: the browser calls (mocked) Gemini, then buildVoxelResponse
// runs FOR REAL (assemble -> ground -> compileVoxelBuilderSpec). No worker, no key.

describe("createBrowserGeminiAiWorkerClient", () => {
  it("createDraft compiles the LLM core into a builder spec", async () => {
    const fetchImpl = (async () => geminiResponse(treeCore)) as unknown as typeof fetch;
    const client = createBrowserGeminiAiWorkerClient({ apiKey: () => "k", fetchImpl });

    const draft = await client.createDraft({ prompt: "a pine tree" });

    const source = draft.sourceSpec as VoxelBuilderSpec;
    const builder = draft.builderSpec as BuilderSpec;
    expect(source.object_category).toBe("pine_tree");
    // 2 ops in the core -> 2 compiled parts.
    expect(builder.complexity.part_count).toBe(2);
  });

  it("createEdit recolors the object from the change request", async () => {
    const fetchImpl = (async () => geminiResponse(redTreeCore)) as unknown as typeof fetch;
    const client = createBrowserGeminiAiWorkerClient({ apiKey: () => "k", fetchImpl });

    const edit = await client.createEdit({
      baseObjectId: "pine_tree_1",
      baseVersion: 1,
      sourcePrompt: "make it red",
      objectContext: {
        objectId: "pine_tree_1",
        version: 1,
        sourceSpecJson: sourceSpecJsonFor(treeCore),
        builderSpecJson: "{}",
      },
    });

    const builder = edit.builderSpec as BuilderSpec;
    expect(builder.parts.map((part) => part.material)).toContain("red");
  });

  it("createEdit rejects an object with no source spec", async () => {
    const fetchImpl = (async () => geminiResponse(redTreeCore)) as unknown as typeof fetch;
    const client = createBrowserGeminiAiWorkerClient({ apiKey: () => "k", fetchImpl });

    await expect(
      client.createEdit({
        baseObjectId: "x",
        baseVersion: 1,
        sourcePrompt: "make it red",
        objectContext: { objectId: "x", version: 1, sourceSpecJson: null, builderSpecJson: null },
      }),
    ).rejects.toMatchObject({ code: "unsupported_request" });
  });

  it("createDraft requires a key", async () => {
    const fetchImpl = (async () => geminiResponse(treeCore)) as unknown as typeof fetch;
    const client = createBrowserGeminiAiWorkerClient({ apiKey: () => null, fetchImpl });
    await expect(client.createDraft({ prompt: "x" })).rejects.toMatchObject({
      code: "generation_failed",
    });
  });
});
