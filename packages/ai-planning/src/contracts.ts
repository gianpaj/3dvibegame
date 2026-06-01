import { z } from "zod";

export const createPlanSystemPrompt =
  "You plan simple voxel objects for Vibe World. Return a small, safe, world-native create plan only. Do not request terrain edits, accounts, economy, combat, scripting, raw meshes, or destructive actions.";

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
  object_category: z.string().trim().min(1).max(40),
  size_tier: z.enum(["tiny", "small", "medium", "large"]),
  shape: z.enum(["tree", "structure", "creature", "cluster", "marker", "prop"]),
  palette: z.enum(["forest", "stone", "warm", "cool", "magic", "neutral"]),
  style_tags: z.array(z.string().trim().min(1).max(32)).min(1).max(6),
  behaviors: z.array(z.string().trim().min(1).max(32)).max(3),
  key_features: z.array(z.string().trim().min(1).max(48)).min(1).max(5),
});

export type CreatePlan = z.infer<typeof createPlanSchema>;

export const createPlanJsonSchema = {
  type: "object",
  properties: {
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
