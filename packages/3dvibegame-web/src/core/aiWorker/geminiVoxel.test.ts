import { describe, expect, it } from "vitest";

import { AiWorkerError } from "@/core/aiWorker/aiWorkerErrors";
import {
  coreFromSourceSpec,
  generateVoxelCore,
  generateVoxelEdit,
} from "@/core/aiWorker/geminiVoxel";
import {
  geminiErrorResponse,
  geminiResponse,
  redTreeCore,
  sourceSpecJsonFor,
  treeCore,
} from "@/test/fakeGemini";

const base = { apiKey: "test-key", model: "gemini-2.5-flash", temperature: 0.2, timeoutMs: 5000 };

describe("generateVoxelCore", () => {
  it("returns the parsed core and sends the create prompt", async () => {
    let body: Record<string, any> | null = null;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return geminiResponse(treeCore);
    }) as unknown as typeof fetch;

    const core = await generateVoxelCore({ ...base, fetchImpl, prompt: "a pine tree" });

    expect(core.object_category).toBe("pine_tree");
    expect(body!.systemInstruction.parts[0].text).toContain("voxel-builder assistant");
    expect(body!.contents[0].parts[0].text).toContain("a pine tree");
  });

  it("throws on truncated (MAX_TOKENS) output", async () => {
    const fetchImpl = (async () => geminiResponse(treeCore, "MAX_TOKENS")) as unknown as typeof fetch;
    await expect(generateVoxelCore({ ...base, fetchImpl, prompt: "x" })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("throws validation_failed on non-JSON text", async () => {
    const fetchImpl = (async () => geminiResponse("not json at all")) as unknown as typeof fetch;
    await expect(generateVoxelCore({ ...base, fetchImpl, prompt: "x" })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("throws validation_failed when the core fails the schema", async () => {
    const fetchImpl = (async () =>
      geminiResponse({ object_category: "x" })) as unknown as typeof fetch;
    await expect(generateVoxelCore({ ...base, fetchImpl, prompt: "x" })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("throws generation_failed on an HTTP error", async () => {
    const fetchImpl = (async () => geminiErrorResponse(500, "server boom")) as unknown as typeof fetch;
    await expect(generateVoxelCore({ ...base, fetchImpl, prompt: "x" })).rejects.toMatchObject({
      code: "generation_failed",
    });
  });
});

describe("generateVoxelEdit", () => {
  it("sends the edit prompt with the current core + change request", async () => {
    let body: Record<string, any> | null = null;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return geminiResponse(redTreeCore);
    }) as unknown as typeof fetch;

    const core = await generateVoxelEdit({
      ...base,
      fetchImpl,
      currentCore: treeCore,
      changePrompt: "make it red",
    });

    expect(core.materials.map((m) => m.material_id)).toContain("red");
    expect(body!.systemInstruction.parts[0].text).toContain("editing an EXISTING object");
    expect(body!.contents[0].parts[0].text).toContain("make it red");
    // The current core is embedded so the LLM edits rather than regenerates.
    expect(body!.contents[0].parts[0].text).toContain("pine_tree");
  });
});

describe("coreFromSourceSpec", () => {
  it("reduces a stored source spec back to a voxel core", () => {
    const core = coreFromSourceSpec(sourceSpecJsonFor(treeCore));
    expect(core?.object_category).toBe("pine_tree");
    expect(core?.operations).toHaveLength(2);
  });

  it("returns null for missing or invalid specs", () => {
    expect(coreFromSourceSpec(null)).toBeNull();
    expect(coreFromSourceSpec("not json")).toBeNull();
  });
});

// Sanity: the timeout/abort path produces an AiWorkerError, not a raw DOMException.
describe("error typing", () => {
  it("wraps failures in AiWorkerError", async () => {
    const fetchImpl = (async () => geminiResponse("not json")) as unknown as typeof fetch;
    await expect(
      generateVoxelCore({ ...base, fetchImpl, prompt: "x" }),
    ).rejects.toBeInstanceOf(AiWorkerError);
  });
});
