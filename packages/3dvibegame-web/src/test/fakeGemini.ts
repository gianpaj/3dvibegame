import {
  buildVoxelResponse,
  type AiWorkerRequest,
  type VoxelCore,
} from "@3dvibegame/ai-planning";

/** A small but valid voxel core (2 ops) used across the AI mock tests. */
export const treeCore: VoxelCore = {
  object_category: "pine_tree",
  size_tier: "medium",
  style_tags: ["forest"],
  behaviors: [],
  materials: [{ material_id: "wood" }, { material_id: "moss_stone" }],
  operations: [
    { op_id: "trunk", kind: "add_box", position: [0, 1, 0], size: [0.5, 2, 0.5], material_id: "wood" },
    { op_id: "canopy", kind: "add_sphere", center: [0, 2.5, 0], radius: 1, material_id: "moss_stone" },
  ],
  quantity: 1,
};

/** The same tree, recolored red — what an LLM edit of "make it red" would return. */
export const redTreeCore: VoxelCore = {
  ...treeCore,
  materials: [{ material_id: "red" }],
  operations: [
    { op_id: "trunk", kind: "add_box", position: [0, 1, 0], size: [0.5, 2, 0.5], material_id: "red" },
    { op_id: "canopy", kind: "add_sphere", center: [0, 2.5, 0], radius: 1, material_id: "red" },
  ],
  quantity: 1,
};

/** A Gemini `generateContent` response carrying a voxel core (or raw text). */
export function geminiResponse(
  textOrCore: string | VoxelCore | object,
  finishReason = "STOP",
): Response {
  const text = typeof textOrCore === "string" ? textOrCore : JSON.stringify(textOrCore);
  const body = {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A Gemini HTTP error response. */
export function geminiErrorResponse(status: number, message = "boom"): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A worker `/compile` response — a real compile of `core` (so the artifact is valid). */
export function compileResponse(sourcePrompt: string, core: VoxelCore): Response {
  const request: AiWorkerRequest = {
    operation: "create",
    source_prompt: sourcePrompt,
    target_object_id: null,
    base_object_version: null,
    object_context: null,
  };
  const completed = buildVoxelResponse(request, core, []);
  return new Response(JSON.stringify(completed), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The `source_spec_json` an object would store, for editing context. */
export function sourceSpecJsonFor(core: VoxelCore): string {
  const request: AiWorkerRequest = {
    operation: "create",
    source_prompt: "fixture",
    target_object_id: null,
    base_object_version: null,
    object_context: null,
  };
  return JSON.stringify(buildVoxelResponse(request, core, []).source_spec);
}
