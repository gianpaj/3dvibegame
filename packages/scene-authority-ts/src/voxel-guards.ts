import { z } from "zod";

import type { VoxelBuilderSpec } from "./voxel-contracts";

const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

const relationSchema = z.enum([
  "left_of",
  "right_of",
  "behind",
  "in_front_of",
  "around",
]);

const blendModeSchema = z.enum([
  "union",
  "subtract",
  "intersect",
  "exclude",
]);

const regionSelectorSchema = z.object({
  by_bounds: z
    .object({
      min: vector3Schema,
      max: vector3Schema,
    })
    .optional(),
  by_tags: z.array(z.string()).optional(),
  by_material_ids: z.array(z.string()).optional(),
});

const addBoxOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("add_box"),
  mode: blendModeSchema.optional(),
  position: vector3Schema,
  size: vector3Schema,
  material_id: z.string(),
  tags: z.array(z.string()).optional(),
});

const addSphereOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("add_sphere"),
  mode: blendModeSchema.optional(),
  center: vector3Schema,
  radius: z.number(),
  material_id: z.string(),
  tags: z.array(z.string()).optional(),
});

const addLineOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("add_line"),
  mode: blendModeSchema.optional(),
  from: vector3Schema,
  to: vector3Schema,
  radius: z.number(),
  shape: z.enum(["rounded", "square"]).optional(),
  material_id: z.string(),
  tags: z.array(z.string()).optional(),
});

const paintRegionOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("paint_region"),
  target: regionSelectorSchema,
  material_id: z.string(),
});

const rotateRegionOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("rotate_region"),
  target: regionSelectorSchema,
  rotate: z.object({
    axis: z.enum(["x", "y", "z"]),
    turns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    center: vector3Schema.optional(),
  }),
});

const cloneRegionOpSchema = z.object({
  op_id: z.string(),
  kind: z.literal("clone_region"),
  target: regionSelectorSchema,
  copies: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("linear"),
      count: z.number().int().nonnegative(),
      step: vector3Schema,
    }),
    z.object({
      type: z.literal("radial"),
      count: z.number().int().nonnegative(),
      center: vector3Schema,
      axis: z.enum(["x", "y", "z"]),
    }),
  ]),
  mode: blendModeSchema.optional(),
});

export const voxelBuilderSpecSchema = z.object({
  spec_version: z.literal("0.1"),
  request_id: z.string(),
  intent_id: z.string(),
  operation: z.enum(["create", "refine", "remix"]),
  target_object_id: z.string().nullable().optional(),
  base_object_version: z.number().nullable().optional(),
  object_category: z.string(),
  size_tier: z.string(),
  style_tags: z.array(z.string()),
  behaviors: z.array(z.string()),
  grid: z.object({
    unit_meters: z.number().positive(),
    up_axis: z.literal("y"),
    rotation_step_degrees: z.literal(90),
  }),
  placement: z.object({
    mode: z.string(),
    reference_object: z.string().nullable().optional(),
    relation: relationSchema.nullable().optional(),
    offset: vector3Schema,
  }),
  materials: z.array(
    z.object({
      material_id: z.string(),
      label: z.string().optional(),
      render_class: z.string().optional(),
      color_hint: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
  anchors: z.array(
    z.object({
      anchor_id: z.string(),
      position: vector3Schema,
      tags: z.array(z.string()).optional(),
    }),
  ),
  operations: z.array(
    z.discriminatedUnion("kind", [
      addBoxOpSchema,
      addSphereOpSchema,
      addLineOpSchema,
      paintRegionOpSchema,
      rotateRegionOpSchema,
      cloneRegionOpSchema,
    ]),
  ),
  compile_hints: z
    .object({
      preferred_runtime: z
        .enum(["primitive_parts", "merged_mesh", "instanced_voxels"])
        .optional(),
      preserve_edit_regions: z.boolean().optional(),
      preview_camera: z
        .object({
          angle_degrees: z.number().optional(),
          elevation: z.number().optional(),
        })
        .optional(),
      collision_detail: z.enum(["coarse", "medium", "full"]).optional(),
    })
    .nullable()
    .optional(),
  diagnostics: z.array(z.string()),
});

export function parseVoxelBuilderSpec(value: unknown): VoxelBuilderSpec {
  return voxelBuilderSpecSchema.parse(value) as VoxelBuilderSpec;
}
