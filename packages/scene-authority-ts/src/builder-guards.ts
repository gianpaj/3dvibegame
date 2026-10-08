import { z } from "zod";

import type { BuilderSpec } from "./contracts";

// Structural schema for a compiled BuilderSpec. It checks shape and finite
// numbers only; geometry plausibility (empty or degenerate parts) is left to
// callers, which classify it differently from malformed JSON.
const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

const relationSchema = z.enum([
  "left_of",
  "right_of",
  "behind",
  "in_front_of",
  "around",
]);

export const builderPartSchema = z.object({
  part_id: z.string(),
  primitive: z.string(),
  material: z.string(),
  dimensions: vector3Schema,
  modifiers: z.array(z.string()),
  local_position: vector3Schema.optional(),
  local_rotation: vector3Schema.optional(),
  local_scale: vector3Schema.optional(),
});

export const builderSpecSchema = z.object({
  builder_version: z.string(),
  request_id: z.string(),
  intent_id: z.string(),
  operation: z.enum(["create", "refine", "remix"]),
  target_object_id: z.string().nullable().optional(),
  base_object_version: z.number().nullable().optional(),
  object_category: z.string(),
  size_tier: z.string(),
  parts: z.array(builderPartSchema),
  instances: z.array(
    z.object({
      instance_id: z.string(),
      anchor_mode: z.string(),
      reference_object: z.string().nullable().optional(),
      relation: relationSchema.nullable().optional(),
      offset: vector3Schema,
    }),
  ),
  attachments: z.array(z.record(z.string(), z.unknown())),
  materials: z.array(z.string()),
  behaviors: z.array(z.string()),
  placement: z.object({
    mode: z.string(),
    reference_object: z.string().nullable().optional(),
    relation: relationSchema.nullable().optional(),
    offset_meters: z.number().nullable().optional(),
  }),
  complexity: z.object({
    part_count: z.number(),
    instance_count: z.number(),
    behavior_count: z.number(),
  }),
  diagnostics: z.array(z.string()),
});

export function parseBuilderSpec(value: unknown): BuilderSpec {
  return builderSpecSchema.parse(value);
}
