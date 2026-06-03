import { z } from "zod";

export const createPlanSystemPrompt =
  "You plan simple voxel objects for Vibe World. If the player prompt is meaningless (random characters, gibberish, or not interpretable as a 3D object concept), set `rejection` to a brief reason and provide minimal valid values for all other required fields. Otherwise leave `rejection` unset and return a small, safe, world-native create plan only. Do not request terrain edits, accounts, economy, combat, scripting, raw meshes, or destructive actions.";

export const aiWorkerFailureCodes = [
  "invalid_prompt",
  "unsupported_request",
  "unsafe_request",
  "context_stale",
  "generation_failed",
  "validation_failed",
  "timeout",
] as const;

export type AiWorkerFailureCode = (typeof aiWorkerFailureCodes)[number];

export const aiWorkerRequestSchema = z.object({
  operation: z.enum(["create", "refine", "remix"]),
  source_prompt: z.string().trim().min(1).max(1_000),
  action_id: z.string().optional(),
  target_object_id: z.string().nullable().optional(),
  base_object_version: z.number().int().positive().nullable().optional(),
  object_context: z.unknown().nullable().optional(),
});

export type AiWorkerRequest = z.infer<typeof aiWorkerRequestSchema>;

export const createPlanSchema = z.object({
  rejection: z.string().trim().min(1).optional(),
  object_category: z.string().trim().min(1).max(40),
  size_tier: z.enum(["tiny", "small", "medium", "large"]),
  shape: z.enum(["tree", "structure", "creature", "cluster", "marker", "prop"]),
  palette: z.enum(["forest", "stone", "warm", "cool", "magic", "neutral"]),
  style_tags: z.array(z.string().trim().min(1).max(32)).min(1).max(6),
  behaviors: z.array(z.string().trim().min(1).max(32)).max(3),
  key_features: z.array(z.string().trim().min(1).max(48)).min(1).max(5),
});

export type CreatePlan = z.infer<typeof createPlanSchema>;

// System prompt for the direct-voxel path: the LLM authors the actual geometry
// (the operations array) rather than picking a high-level shape template. The LLM
// returns only the creative core; the worker assembles the deterministic envelope.
export const voxelBuilderSystemPrompt = [
  "You are a voxel-builder assistant for Vibe World. Given a player's prompt, design a",
  "single small 3D object as a list of voxel operations. Return JSON ONLY (no prose,",
  "no markdown).",
  "",
  "IMPORTANT: If the player prompt is meaningless (random characters, gibberish, or not",
  "interpretable as a 3D object concept), return ONLY: {\"rejection\": \"<brief reason>\"}",
  "Otherwise return a full voxel spec with this exact shape:",
  "{",
  '  "object_category": string,           // e.g. "palm_tree"',
  '  "size_tier": "tiny"|"small"|"medium"|"large",',
  '  "style_tags": string[],',
  '  "behaviors": string[],',
  '  "materials": [{ "material_id": string, "color_hint"?: string }],',
  '  "operations": VoxelOp[]',
  "}",
  "",
  "Each VoxelOp is one of:",
  '- { "op_id": string, "kind": "add_box", "position": [x,y,z], "size": [w,h,d], "material_id": string, "tags"?: string[] }',
  '- { "op_id": string, "kind": "add_sphere", "center": [x,y,z], "radius": number, "material_id": string, "tags"?: string[] }',
  '- { "op_id": string, "kind": "add_line", "from": [x,y,z], "to": [x,y,z], "radius": number, "shape"?: "rounded"|"square", "material_id": string, "tags"?: string[] }',
  "",
  "Rules:",
  "- y is up. Keep the object near y=0 (above the floor) and roughly 2-5 units tall.",
  "- Every op_id is unique; every material_id used must be declared in materials.",
  "- Use ONLY these material ids so colors render: moss_stone, wood, neon, glass_block,",
  "  jelly, cloud, lava_light, void, red, stone.",
  "- Build the real silhouette of the requested object and make different prompts produce",
  "  different geometry (a palm tree = tall slender trunk + splayed fronds; a pine =",
  "  conical layered canopy; a barrel = stacked cylinders/boxes).",
  "- Aim for 4-14 operations.",
].join("\n");

// System prompt for editing an existing object: the LLM is given the object's
// current voxel core plus a change request, and returns the full edited core in the
// same shape as a create. Reuses the same /compile path.
export const voxelEditSystemPrompt = [
  "You are a voxel-builder assistant for Vibe World editing an EXISTING object. You are",
  "given the object's current voxel core (materials + operations) and a change request.",
  "",
  "IMPORTANT: If the change request is meaningless (random characters, gibberish, or not",
  "interpretable as an edit instruction), return ONLY: {\"rejection\": \"<brief reason>\"}",
  "Otherwise apply the change and return the FULL edited voxel core as JSON ONLY (no prose, no",
  "markdown) with this exact shape:",
  "{",
  '  "object_category": string,',
  '  "size_tier": "tiny"|"small"|"medium"|"large",',
  '  "style_tags": string[],',
  '  "behaviors": string[],',
  '  "materials": [{ "material_id": string, "color_hint"?: string }],',
  '  "operations": VoxelOp[]',
  "}",
  "",
  "Each VoxelOp is one of:",
  '- { "op_id": string, "kind": "add_box", "position": [x,y,z], "size": [w,h,d], "material_id": string, "tags"?: string[] }',
  '- { "op_id": string, "kind": "add_sphere", "center": [x,y,z], "radius": number, "material_id": string, "tags"?: string[] }',
  '- { "op_id": string, "kind": "add_line", "from": [x,y,z], "to": [x,y,z], "radius": number, "shape"?: "rounded"|"square", "material_id": string, "tags"?: string[] }',
  "",
  "Rules:",
  "- PRESERVE everything the change doesn't touch — keep the existing operations, ids,",
  "  positions, and sizes unless the change requires altering them.",
  "- For a recolor, change the relevant `material_id`s (and declare them in materials).",
  '  Use ONLY these material ids so colors render: moss_stone, wood, neon, glass_block,',
  "  jelly, cloud, lava_light, void, red, stone.",
  '- For "add X", append new operations with new unique op_ids.',
  '- For "remove X" or "make it smaller", drop or shrink the relevant operations.',
  "- y is up; keep it grounded near y=0. Every op_id unique; every material_id declared.",
  "- Keep the total to at most ~16 operations.",
].join("\n");

// Request shape for the worker's /compile endpoint: the LLM-authored voxel core
// (from a browser-side Gemini call) that the worker grounds, validates, and compiles
// into a builder spec. No LLM key is needed on this path.
export const voxelCoreSchema = z.object({
  object_category: z.string().trim().min(1).max(60),
  size_tier: z.string().trim().min(1).max(20),
  style_tags: z.array(z.string()).max(12).optional().default([]),
  behaviors: z.array(z.string()).max(6).optional().default([]),
  materials: z
    .array(
      z.object({
        material_id: z.string().trim().min(1).max(40),
        color_hint: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(12),
  // Operations are validated strictly after envelope assembly via parseVoxelBuilderSpec.
  operations: z.array(z.unknown()).min(1).max(40),
});

export type VoxelCore = z.infer<typeof voxelCoreSchema>;

export const compileVoxelRequestSchema = z.object({
  operation: z.literal("create"),
  source_prompt: z.string().trim().min(1).max(1_000),
  voxel: voxelCoreSchema,
  warnings: z.array(z.string()).max(10).optional(),
});

export type CompileVoxelRequest = z.infer<typeof compileVoxelRequestSchema>;

export const createPlanJsonSchema = {
  type: "object",
  properties: {
    rejection: {
      type: "string",
      description: "Set only when the prompt is meaningless or cannot be interpreted as a 3D object. Leave absent otherwise.",
    },
    object_category: {
      type: "string",
      description: "Short world-object category, such as pine_tree, bridge, shrine, or marker.",
    },
    size_tier: {
      type: "string",
      enum: ["tiny", "small", "medium", "large"],
    },
    shape: {
      type: "string",
      enum: ["tree", "structure", "creature", "cluster", "marker", "prop"],
    },
    palette: {
      type: "string",
      enum: ["forest", "stone", "warm", "cool", "magic", "neutral"],
    },
    style_tags: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "string",
      },
    },
    behaviors: {
      type: "array",
      maxItems: 3,
      items: {
        type: "string",
      },
    },
    key_features: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "string",
      },
    },
  },
  required: [
    "object_category",
    "size_tier",
    "shape",
    "palette",
    "style_tags",
    "behaviors",
    "key_features",
  ],
  propertyOrdering: [
    "object_category",
    "size_tier",
    "shape",
    "palette",
    "style_tags",
    "behaviors",
    "key_features",
  ],
} as const;

export interface CreatePlanInput {
  sourcePrompt: string;
  signal?: AbortSignal;
}

export interface CreatePlanResult {
  plan: CreatePlan;
  warnings?: string[];
}

export interface CreatePlanGenerator {
  generateCreatePlan(input: CreatePlanInput): Promise<CreatePlanResult>;
}

export interface AiWorkerCompletedResponse {
  status: "completed";
  job_id_base: string;
  object_id_base: string;
  source_spec: unknown;
  builder_spec: unknown;
  warnings: string[];
}

export interface AiWorkerFailedResponse {
  status: "failed";
  error_code: AiWorkerFailureCode;
  message: string;
}

export type AiWorkerResponse = AiWorkerCompletedResponse | AiWorkerFailedResponse;
