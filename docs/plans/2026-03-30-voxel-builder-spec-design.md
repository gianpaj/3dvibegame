# Voxel Builder Spec Design

Date: 2026-03-30

## Goal

Define a voxel-aware object authoring contract that can express the operations the product cares about:

- add and remove volume
- combine shapes with boolean operations
- rotate in grid-safe steps
- change size in object space
- paint and restyle regions
- duplicate and lay out repeated forms

The spec must preserve voxel-native editing as the creative source of truth while still allowing the runtime to compile that source into cheaper render artifacts for performance.

## Decision

Editable world objects will use a voxel-aware authoring spec as the canonical creative source.

The runtime is still allowed, and expected, to compile that source into one or more derived artifacts for performance. This means the project is not choosing between "canonical voxel source" and "DSL compilation." It is choosing both:

- `VoxelBuilderSpec` is the source of truth for editable objects
- compiled runtime artifacts are cacheable derivatives of that source

This keeps the editing model expressive without forcing the live world to render raw voxel data directly.

## Why This Direction

The repo already supports object-level move, rotate, and scale, but the current `BuilderSpec` is still primitive-part based. It does not preserve true voxel occupancy, boolean edits, or voxel-native remix operations.

If object creation and refinement are part of the game loop, the source of truth needs to preserve:

- how the object was built
- where mass was added or removed
- which edits were semantic shape edits versus world placement edits
- deterministic replay of the same edit sequence

That is the main benefit of a voxel-aware authoring spec.

The counter-pressure is runtime performance. Large worlds should not depend on naive per-voxel rendering or per-edit full rebuilds in the main client. That is why compilation is part of the design from the start.

## Non-Goals

This spec does not try to define:

- terrain chunk storage
- a final mesh format
- physics or collision internals
- multiplayer transport packets
- skeletal animation
- a renderer-specific API

Those systems may consume compiled artifacts derived from this source, but they are not the source contract.

## Design Principles

### 1. Source and runtime are separate

The editable source contract should describe object construction and edit intent.

The runtime artifact should describe what the renderer or simulation needs to consume cheaply.

### 2. Object-space edits stay grid-native

Canonical shape edits should remain aligned to a voxel grid. That means:

- primitive sizes are grid-based
- boolean edits are voxel-based
- rotations in the source spec are limited to 90 degree turns
- resize is expressed by changing primitive dimensions or replaying an operation with new parameters

This avoids resampling noise and keeps edits deterministic.

### 3. World transforms stay separate from shape edits

An object's placement in the world is not the same thing as the shape authoring model.

World transforms still belong in authority state:

- position
- rotation
- scale

The voxel spec defines the object in local space. Authority state defines where that object sits in the world.

### 4. Compilation is a feature, not a fallback

The source spec should compile into artifacts optimized for different surfaces:

- live Three.js world rendering
- SVG preview cards
- collision or occupancy queries
- moderation or diff tools

The compiler boundary is intentional.

## Proposed Architecture

```txt
prompt / edit intent
  -> VoxelBuilderSpec (canonical editable source)
  -> compiler
  -> CompiledBuilderArtifact(s)
  -> runtime renderer / preview renderer / collision / tooling
```

At the authority level, each object version should be tied to:

- one canonical `VoxelBuilderSpec`
- zero or more compiled artifacts keyed by compiler version and target

If a compiled artifact is missing or stale, the source spec remains valid.

## Canonical Source Contract

### `VoxelBuilderSpec`

```ts
interface VoxelBuilderSpec {
  spec_version: "0.1";
  request_id: string;
  intent_id: string;
  operation: "create" | "refine" | "remix";
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
    mode: "absolute" | "relative";
    reference_object?: string | null;
    relation?: "left_of" | "right_of" | "behind" | "in_front_of" | "around" | null;
    offset: [number, number, number];
  };
  materials: VoxelMaterial[];
  anchors: VoxelAnchor[];
  operations: VoxelOp[];
  compile_hints?: CompileHints | null;
  diagnostics: string[];
}
```

### `VoxelMaterial`

```ts
interface VoxelMaterial {
  material_id: string;
  label?: string;
  render_class?: string;
  color_hint?: string;
  tags?: string[];
}
```

This is intentionally lightweight. The source spec needs stable material identity more than renderer-specific shading fields.

### `placement`

Placement belongs in the source contract because editable object versions still need stable world-anchor intent.

The important distinction is:

- `placement.offset` is a voxel-grid local offset that compiles cleanly into runtime placement data
- authority `transform.position / rotation / scale` is the live world transform applied to the accepted object instance

That separation preserves semantic authoring intent without collapsing it into ad hoc scene transforms.

### `VoxelAnchor`

```ts
interface VoxelAnchor {
  anchor_id: string;
  position: [number, number, number];
  tags?: string[];
}
```

Anchors give the compiler and the world useful attachment points without baking in a rendering strategy.

Examples:

- trunk base
- top center
- seat position
- socket for props

## Operation Model

Operations run in order against an object-local voxel field.

Every constructive operation can declare how it combines with existing mass:

```ts
type BlendMode = "union" | "subtract" | "intersect" | "exclude";
```

This is the key capability we want to preserve from a voxel-native builder model.

For the first compiler target, only `union` needs to compile into the current part-based runtime artifact. The other blend modes remain part of the source contract, but they can compile later into richer runtime targets.

### `VoxelOp`

```ts
type VoxelOp =
  | AddBoxOp
  | AddSphereOp
  | AddLineOp
  | PaintRegionOp
  | RotateRegionOp
  | CloneRegionOp;
```

### Constructive primitives

```ts
interface AddBoxOp {
  op_id: string;
  kind: "add_box";
  mode?: BlendMode;
  position: [number, number, number];
  size: [number, number, number];
  material_id: string;
  tags?: string[];
}

interface AddSphereOp {
  op_id: string;
  kind: "add_sphere";
  mode?: BlendMode;
  center: [number, number, number];
  radius: number;
  material_id: string;
  tags?: string[];
}

interface AddLineOp {
  op_id: string;
  kind: "add_line";
  mode?: BlendMode;
  from: [number, number, number];
  to: [number, number, number];
  radius: number;
  shape?: "rounded" | "square";
  material_id: string;
  tags?: string[];
}
```

These cover the minimum useful shape vocabulary while staying easy to reason about.

### Paint and styling

```ts
interface PaintRegionOp {
  op_id: string;
  kind: "paint_region";
  target: RegionSelector;
  material_id: string;
}
```

This lets edits restyle an existing mass without rebuilding the entire object.

### Rotation

```ts
interface RotateRegionOp {
  op_id: string;
  kind: "rotate_region";
  target: RegionSelector;
  rotate: {
    axis: "x" | "y" | "z";
    turns: 1 | 2 | 3;
    center?: [number, number, number];
  };
}
```

Source rotations are limited to 90 degree steps. That preserves the grid and keeps edits deterministic.

### Duplication and repeated layouts

```ts
interface CloneRegionOp {
  op_id: string;
  kind: "clone_region";
  target: RegionSelector;
  copies:
    | {
        type: "linear";
        count: number;
        step: [number, number, number];
      }
    | {
        type: "radial";
        count: number;
        center: [number, number, number];
        axis: "x" | "y" | "z";
      };
  mode?: BlendMode;
}
```

This is how the source spec should express things like:

- three barrels around a campfire
- mirrored wings
- repeated fence posts

It is cheaper and clearer than manually listing every voxel edit.

### Region targeting

```ts
interface RegionSelector {
  by_bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  by_tags?: string[];
  by_material_ids?: string[];
}
```

Selections should stay simple in v0.1. Bounding boxes, tags, and material filters are enough to enable useful edits without creating a full query language.

## How To Express Core User Actions

### Add or sum objects

Use constructive ops with `mode: "union"`.

Example:

- add trunk box
- add canopy sphere
- add second canopy box with `union`

### Carve or subtract

Use the same constructive ops with `mode: "subtract"`.

Example:

- subtract a doorway box
- subtract a sphere to round a cavity

### Rotate

Use `rotate_region` in the source spec for grid-safe authoring edits.

Use authority/world transforms for temporary placement rotation in the scene.

### Change size

There are two different meanings of "size":

- shape size: edit primitive dimensions or replay operations with new parameters
- world display size: use object transform scale in authority state

The spec should keep those separate.

For canonical shape editing, resizing should prefer explicit dimensional changes over arbitrary mesh scaling.

## Compile Hints

The source spec may include non-authoritative hints for the compiler.

```ts
interface CompileHints {
  preferred_runtime?: "primitive_parts" | "merged_mesh" | "instanced_voxels";
  preserve_edit_regions?: boolean;
  preview_camera?: {
    angle_degrees?: number;
    elevation?: number;
  };
  collision_detail?: "coarse" | "medium" | "full";
}
```

These hints help the compiler choose a good output, but they are not the source of truth.

## Compiled Runtime Artifacts

The compiler should emit derived artifacts for specific consumers.

```ts
interface CompiledBuilderArtifact {
  artifact_version: "0.1";
  source_spec_hash: string;
  compiler_version: string;
  target:
    | "three_runtime"
    | "svg_preview"
    | "collision"
    | "occupancy_query";
  object_category: string;
  bounds_voxels: [number, number, number];
  bounds_meters: [number, number, number];
  payload: Record<string, unknown>;
  diagnostics: string[];
}
```

Important rule: compiled artifacts are disposable. If the runtime payload becomes obsolete, the system can regenerate it from the canonical source spec.

## Recommended First Compiler Target

The first compiler target should not invent a brand-new renderer contract.

It should compile `VoxelBuilderSpec` into a runtime artifact that looks close to the repo's current part-based `BuilderSpec` shape:

- primitive parts
- instances
- placement
- material list
- bounds and diagnostics

That gives the project a migration path with minimal renderer churn.

In other words:

1. keep Three.js runtime moving
2. add voxel-native authoring upstream
3. compile into the current runtime seam first
4. improve runtime artifacts later if needed

## Authority Model Impact

Long term, authoritative objects should stop treating the current `BuilderSpec` as the only object-definition field.

The authority layer should conceptually store:

```ts
interface AuthorityObjectDefinition {
  source_spec: VoxelBuilderSpec;
  compiled_artifacts?: CompiledBuilderArtifact[];
}
```

Versioning should follow the source spec:

- editing the voxel source increments object version
- recompiling artifacts does not change object version by itself
- compiler version changes invalidate cached artifacts, not user intent

## Migration Plan

### Phase 1

Keep the current `BuilderSpec`-based renderer and fixtures.

Add the new spec doc and introduce `VoxelBuilderSpec` types in parallel.

### Phase 2

Build a compiler that turns `VoxelBuilderSpec` into the current runtime `BuilderSpec`-like artifact.

Use existing demo scenes as golden fixtures.

### Phase 3

Update authority objects so editable versions store canonical voxel source plus compiled runtime cache.

### Phase 4

Add additional compiler targets:

- SVG preview
- collision occupancy
- richer merged runtime meshes

## Success Criteria

This design succeeds if it gives the repo all of the following without coupling them together:

- voxel-native editing
- deterministic object remix
- clear boolean composition
- grid-safe rotation
- semantic size edits
- efficient runtime rendering in large worlds

## Decision Summary

The project should treat voxel-native authoring as the editable truth and compiled artifacts as performance-oriented derivatives.

That preserves the important part of the voxel idea without forcing the live world to render raw voxel data directly.
