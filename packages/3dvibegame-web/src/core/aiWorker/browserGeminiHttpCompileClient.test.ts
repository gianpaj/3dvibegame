import { describe, expect, it } from "vitest";
import type { BuilderSpec, VoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { createBrowserGeminiHttpCompileClient } from "@/core/aiWorker/browserGeminiHttpCompileClient";
import {
  compileResponse,
  geminiResponse,
  redTreeCore,
  sourceSpecJsonFor,
  treeCore,
} from "@/test/fakeGemini";
import type { VoxelCore } from "@3dvibegame/ai-planning";

// Worker-compile client: the browser calls (mocked) Gemini, then POSTs the core to the
// (mocked) worker /compile endpoint. Fetch is routed by URL.
function routedFetch(geminiCore: VoxelCore, compileCore: VoxelCore, sourcePrompt: string) {
  let compileBody: Record<string, any> | null = null;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("generativelanguage")) return geminiResponse(geminiCore);
    if (u.endsWith("/compile")) {
      compileBody = JSON.parse(String(init?.body));
      return compileResponse(sourcePrompt, compileCore);
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, getCompileBody: () => compileBody };
}

describe("createBrowserGeminiHttpCompileClient", () => {
  it("createDraft POSTs the LLM core to /compile and returns the artifact", async () => {
    const { fetchImpl, getCompileBody } = routedFetch(treeCore, treeCore, "a pine tree");
    const client = createBrowserGeminiHttpCompileClient({
      apiKey: () => "k",
      workerUrl: "https://worker.example",
      fetchImpl,
    });

    const draft = await client.createDraft({ prompt: "a pine tree" });

    const body = getCompileBody()!;
    expect(body.operation).toBe("create");
    expect(body.source_prompt).toBe("a pine tree");
    expect(body.voxel.object_category).toBe("pine_tree");

    const source = draft.sourceSpec as VoxelBuilderSpec;
    const builder = draft.builderSpec as BuilderSpec;
    expect(source.object_category).toBe("pine_tree");
    expect(builder.complexity.part_count).toBe(2);
  });

  it("createEdit sends the recolored core to /compile", async () => {
    const { fetchImpl, getCompileBody } = routedFetch(redTreeCore, redTreeCore, "make it red");
    const client = createBrowserGeminiHttpCompileClient({
      apiKey: () => "k",
      workerUrl: "https://worker.example/",
      fetchImpl,
    });

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

    expect(getCompileBody()!.voxel.materials.map((m: { material_id: string }) => m.material_id)).toContain(
      "red",
    );
    const builder = edit.builderSpec as BuilderSpec;
    expect(builder.parts.map((part) => part.material)).toContain("red");
  });
});
