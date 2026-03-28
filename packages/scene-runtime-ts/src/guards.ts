import { z } from "zod";

import type {
  PlanningOutcome,
  RuntimeTaskArtifact,
  ScenePlanningResponse,
} from "./contracts";

const relationSchema = z.enum([
  "left_of",
  "right_of",
  "behind",
  "in_front_of",
  "around",
]);

const actionTypeSchema = z.enum([
  "add_object",
  "remove_object",
  "move_object",
  "rotate_object",
  "scale_object",
  "set_material",
  "set_color",
  "duplicate_object",
  "group_objects",
  "ungroup_objects",
  "replace_object",
  "set_relation",
  "clear_area",
  "spawn_layout",
  "annotate_constraint",
]);

const responseTypeSchema = z.enum([
  "scene_actions",
  "scene_patch",
  "clarification_request",
  "refusal",
]);

const objectSpecSchema = z.object({
  category: z.string(),
  asset_id: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
});

const positionSpecSchema = z.object({
  mode: z.enum(["absolute", "relative"]),
  reference_object: z.string().nullable().optional(),
  relation: relationSchema.nullable().optional(),
  offset_meters: z.number().nullable().optional(),
  absolute: z.array(z.number()).nullable().optional(),
});

const transformSpecSchema = z.object({
  position: positionSpecSchema.nullable().optional(),
  rotation: z.array(z.number()).nullable().optional(),
  scale: z.array(z.number()).nullable().optional(),
});

const attributesSpecSchema = z.object({
  color: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  count: z.number().int().nullable().optional(),
  layout: z.string().nullable().optional(),
});

const constraintSpecSchema = z.object({
  grounded: z.boolean().nullable().optional(),
  non_overlapping: z.boolean().nullable().optional(),
  preserve_paths_clear: z.boolean().nullable().optional(),
});

const sceneActionSchema = z.object({
  action_type: actionTypeSchema,
  target: z.string().nullable().optional(),
  object_spec: objectSpecSchema.nullable().optional(),
  transform: transformSpecSchema.nullable().optional(),
  attributes: attributesSpecSchema.nullable().optional(),
  constraints: constraintSpecSchema.nullable().optional(),
  references: z.array(z.string()).optional().default([]),
  confidence: z.number(),
});

const uncertaintySchema = z.object({
  has_ambiguity: z.boolean(),
  fields: z.array(z.string()),
});

const clarificationSchema = z.object({
  question: z.string(),
  missing_fields: z.array(z.string()),
});

const refusalSchema = z.object({
  reason: z.string(),
  safe_alternative: z.string().nullable().optional(),
});

export const scenePlanningResponseSchema = z.object({
  schema_version: z.literal("1.0"),
  response_type: responseTypeSchema,
  actions: z.array(sceneActionSchema).nullable().optional(),
  patch: z.record(z.string(), z.unknown()).nullable().optional(),
  clarification: clarificationSchema.nullable().optional(),
  refusal: refusalSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  uncertainty: uncertaintySchema,
});

const objectIntentSchema = z.object({
  intent_id: z.string(),
  operation: z.enum(["create", "refine", "remix"]),
  target_object_id: z.string().nullable().optional(),
  base_object_version: z.number().nullable().optional(),
  category: z.string(),
  size_tier: z.string().nullable().optional(),
  parts: z.array(z.record(z.string(), z.unknown())),
  material_palette: z.record(z.string(), z.unknown()).nullable().optional(),
  behavior_presets: z.array(z.string()),
  transform_hints: z.record(z.string(), z.unknown()).nullable().optional(),
  style_tags: z.array(z.string()),
  instance_count: z.number().int(),
  layout_hint: z
    .object({
      layout_type: z.string().nullable().optional(),
      count: z.number().int().nullable().optional(),
      reference_object: z.string().nullable().optional(),
      relation: relationSchema.nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional().default({}),
    })
    .nullable()
    .optional(),
  source_actions: z.array(actionTypeSchema),
});

const renderDraftSpecSchema = z.object({
  draft_id: z.string(),
  request_id: z.string(),
  intent_id: z.string(),
  display_name: z.string(),
  primitive_nodes: z.array(
    z.object({
      primitive: z.string(),
      transform: z.record(z.string(), z.unknown()),
      material: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional().default({}),
    }),
  ),
  world_anchor: z.object({
    mode: z.string(),
    reference_object: z.string().nullable().optional(),
    relation: relationSchema.nullable().optional(),
    offset_meters: z.number().nullable().optional(),
    absolute: z.array(z.number()).nullable().optional(),
  }),
  bounds_hint: z
    .object({
      size: z.array(z.number()).nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional().default({}),
    })
    .nullable()
    .optional(),
  preview_materials: z.array(z.string()),
  animation_presets: z.array(z.string()),
  warnings: z.array(z.string()),
});

const normalizedScenePlanSchema = z.object({
  plan_version: z.string(),
  request_id: z.string(),
  plan_kind: z.enum(["object_intent", "clarification", "refusal"]),
  source_response_type: responseTypeSchema,
  uncertainty: uncertaintySchema,
  intents: z.array(objectIntentSchema),
  clarification: clarificationSchema.nullable().optional(),
  refusal: refusalSchema.nullable().optional(),
  diagnostics: z.array(z.string()),
});

export const planningOutcomeSchema = z.object({
  request_id: z.string(),
  raw_output: z.string(),
  parsed_response: scenePlanningResponseSchema.nullable().optional(),
  schema_errors: z.array(z.string()),
  normalized_plan: normalizedScenePlanSchema.nullable().optional(),
  render_drafts: z.array(renderDraftSpecSchema),
  diagnostics: z.array(z.string()),
});

export const runtimeTaskArtifactSchema = z.object({
  sample_id: z.string(),
  task_id: z.string(),
  adapter_name: z.string(),
  raw_output: z.string(),
  parsed_response: scenePlanningResponseSchema.nullable().optional(),
  normalized_plan: normalizedScenePlanSchema.nullable().optional(),
  render_drafts: z.array(renderDraftSpecSchema),
  diagnostics: z.array(z.string()).optional().default([]),
});

export function parseScenePlanningResponse(
  value: unknown,
): ScenePlanningResponse {
  return scenePlanningResponseSchema.parse(value) as ScenePlanningResponse;
}

export function parsePlanningOutcome(value: unknown): PlanningOutcome {
  return planningOutcomeSchema.parse(value) as PlanningOutcome;
}

export function parseRuntimeTaskArtifact(value: unknown): RuntimeTaskArtifact {
  return runtimeTaskArtifactSchema.parse(value) as RuntimeTaskArtifact;
}
