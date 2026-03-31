import type {
  BuilderOperation,
  BuilderPlacement,
  BuilderRelation,
} from "./contracts";

export type VoxelVector3 = [number, number, number];
export type BlendMode = "union" | "subtract" | "intersect" | "exclude";

export interface VoxelMaterial {
  material_id: string;
  label?: string;
  render_class?: string;
  color_hint?: string;
  tags?: string[];
}

export interface VoxelAnchor {
  anchor_id: string;
  position: VoxelVector3;
  tags?: string[];
}

export interface RegionSelector {
  by_bounds?: {
    min: VoxelVector3;
    max: VoxelVector3;
  };
  by_tags?: string[];
  by_material_ids?: string[];
}

export interface CompileHints {
  preferred_runtime?: "primitive_parts" | "merged_mesh" | "instanced_voxels";
  preserve_edit_regions?: boolean;
  preview_camera?: {
    angle_degrees?: number;
    elevation?: number;
  };
  collision_detail?: "coarse" | "medium" | "full";
}

export interface AddBoxOp {
  op_id: string;
  kind: "add_box";
  mode?: BlendMode;
  position: VoxelVector3;
  size: VoxelVector3;
  material_id: string;
  tags?: string[];
}

export interface AddSphereOp {
  op_id: string;
  kind: "add_sphere";
  mode?: BlendMode;
  center: VoxelVector3;
  radius: number;
  material_id: string;
  tags?: string[];
}

export interface AddLineOp {
  op_id: string;
  kind: "add_line";
  mode?: BlendMode;
  from: VoxelVector3;
  to: VoxelVector3;
  radius: number;
  shape?: "rounded" | "square";
  material_id: string;
  tags?: string[];
}

export interface PaintRegionOp {
  op_id: string;
  kind: "paint_region";
  target: RegionSelector;
  material_id: string;
}

export interface RotateRegionOp {
  op_id: string;
  kind: "rotate_region";
  target: RegionSelector;
  rotate: {
    axis: "x" | "y" | "z";
    turns: 1 | 2 | 3;
    center?: VoxelVector3;
  };
}

export interface CloneRegionOp {
  op_id: string;
  kind: "clone_region";
  target: RegionSelector;
  copies:
    | {
        type: "linear";
        count: number;
        step: VoxelVector3;
      }
    | {
        type: "radial";
        count: number;
        center: VoxelVector3;
        axis: "x" | "y" | "z";
      };
  mode?: BlendMode;
}

export type VoxelOp =
  | AddBoxOp
  | AddSphereOp
  | AddLineOp
  | PaintRegionOp
  | RotateRegionOp
  | CloneRegionOp;

export interface VoxelPlacement
  extends Omit<BuilderPlacement, "offset_meters"> {
  offset: VoxelVector3;
}

export interface VoxelBuilderSpec {
  spec_version: "0.1";
  request_id: string;
  intent_id: string;
  operation: BuilderOperation;
  target_object_id?: string | null;
  base_object_version?: number | null;
  object_category: string;
  size_tier: string;
  style_tags: string[];
  behaviors: string[];
  grid: {
    unit_meters: number;
    up_axis: "y";
    rotation_step_degrees: 90;
  };
  placement: {
    mode: "absolute" | "relative" | string;
    reference_object?: string | null;
    relation?: BuilderRelation | null;
    offset: VoxelVector3;
  };
  materials: VoxelMaterial[];
  anchors: VoxelAnchor[];
  operations: VoxelOp[];
  compile_hints?: CompileHints | null;
  diagnostics: string[];
}
