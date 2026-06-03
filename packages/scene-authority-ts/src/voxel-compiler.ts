import type { BuilderInstance, BuilderPart, BuilderSpec } from "./contracts";
import type {
  AddBoxOp,
  AddLineOp,
  AddSphereOp,
  BlendMode,
  CloneRegionOp,
  RegionSelector,
  RotateRegionOp,
  VoxelBuilderSpec,
  VoxelVector3,
} from "./voxel-contracts";

type Shape =
  | {
      id: string;
      kind: "box";
      center: VoxelVector3;
      size: VoxelVector3;
      materialId: string;
      tags: string[];
    }
  | {
      id: string;
      kind: "sphere";
      center: VoxelVector3;
      radius: number;
      materialId: string;
      tags: string[];
    }
  | {
      id: string;
      kind: "line";
      from: VoxelVector3;
      to: VoxelVector3;
      radius: number;
      shape: "rounded" | "square";
      materialId: string;
      tags: string[];
    };

export function compileVoxelBuilderSpec(spec: VoxelBuilderSpec): BuilderSpec {
  const diagnostics = [...spec.diagnostics];
  const instancedCloneLayout = compileInstancedCloneLayout(spec, diagnostics);
  if (instancedCloneLayout) {
    return createBuilderSpec({
      spec,
      parts: instancedCloneLayout.parts,
      instances: instancedCloneLayout.instances,
      placementOffsetMeters: instancedCloneLayout.placementOffsetMeters,
      diagnostics,
    });
  }

  // Resolve material_id → effective render name: prefer color_hint when present so
  // the renderer can use the intended color (e.g. "jelly" + color_hint "yellow" → "yellow").
  const resolveMatId = buildMaterialColorResolver(spec.materials);

  let shapes: Shape[] = [];

  spec.operations.forEach((op) => {
    switch (op.kind) {
      case "add_box":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromBox(op));
        break;
      case "add_sphere":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromSphere(op));
        break;
      case "add_line":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromLine(op));
        break;
      case "paint_region":
        shapes = shapes.map((shape) =>
          matchesRegion(shape, op.target)
            ? { ...shape, materialId: op.material_id }
            : shape,
        );
        break;
      case "rotate_region":
        shapes = shapes.map((shape) =>
          matchesRegion(shape, op.target) ? rotateShape(shape, op) : shape,
        );
        break;
      case "clone_region":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes = shapes.concat(cloneShapes(shapes, op, diagnostics));
        break;
      default:
        op satisfies never;
    }
  });

  const parts = shapes.map((shape, index) =>
    toBuilderPart(
      { ...shape, materialId: resolveMatId(shape.materialId) },
      index,
      spec.grid.unit_meters,
      diagnostics,
    ),
  );
  const instanceOffset = scaleVector(
    spec.placement.offset,
    spec.grid.unit_meters,
  );

  return createBuilderSpec({
    spec,
    parts,
    instances: [
      {
        instance_id: "instance_0",
        anchor_mode: spec.placement.mode,
        reference_object: spec.placement.reference_object ?? null,
        relation: spec.placement.relation ?? null,
        offset: instanceOffset,
      },
    ],
    placementOffsetMeters: vectorLength(instanceOffset),
    diagnostics,
  });
}

function createBuilderSpec({
  spec,
  parts,
  instances,
  placementOffsetMeters,
  diagnostics,
}: {
  spec: VoxelBuilderSpec;
  parts: BuilderPart[];
  instances: BuilderInstance[];
  placementOffsetMeters: number;
  diagnostics: string[];
}): BuilderSpec {
  return {
    builder_version: "0.1",
    request_id: spec.request_id,
    intent_id: spec.intent_id,
    operation: spec.operation,
    target_object_id: spec.target_object_id ?? null,
    base_object_version: spec.base_object_version ?? null,
    object_category: spec.object_category,
    size_tier: spec.size_tier,
    parts,
    instances,
    attachments: [],
    materials: unique(parts.map((part) => part.material)),
    behaviors: [...spec.behaviors],
    placement: {
      mode: spec.placement.mode,
      reference_object: spec.placement.reference_object ?? null,
      relation: spec.placement.relation ?? null,
      offset_meters: placementOffsetMeters > 0 ? placementOffsetMeters : null,
    },
    complexity: {
      part_count: parts.length,
      instance_count: instances.length,
      behavior_count: spec.behaviors.length,
    },
    diagnostics,
  };
}

function assertSupportedBlendMode(mode: BlendMode | undefined, opId: string) {
  if (!mode || mode === "union") return;
  throw new Error(
    `current BuilderSpec compiler target only supports union mode; ${opId} requested ${mode}`,
  );
}

function compileInstancedCloneLayout(
  spec: VoxelBuilderSpec,
  diagnostics: string[],
): {
  parts: BuilderPart[];
  instances: BuilderInstance[];
  placementOffsetMeters: number;
} | null {
  const finalOp = spec.operations.at(-1);
  if (!finalOp || finalOp.kind !== "clone_region") return null;

  const seedOps = spec.operations.slice(0, -1);
  if (!seedOps.length) return null;

  let shapes: Shape[] = [];
  for (const op of seedOps) {
    switch (op.kind) {
      case "add_box":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromBox(op));
        break;
      case "add_sphere":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromSphere(op));
        break;
      case "add_line":
        assertSupportedBlendMode(op.mode, op.op_id);
        shapes.push(shapeFromLine(op));
        break;
      default:
        return null;
    }
  }

  assertSupportedBlendMode(finalOp.mode, finalOp.op_id);
  const selected = shapes.filter((shape) => matchesRegion(shape, finalOp.target));
  if (!selected.length || selected.length !== shapes.length) return null;

  const resolveMatId = buildMaterialColorResolver(spec.materials);
  const layoutOrigin = getLayoutOrigin(selected, finalOp);
  const localShapes = selected.map((shape) =>
    translateShape(shape, scaleVector(layoutOrigin, -1)),
  );
  const parts = localShapes.map((shape, index) =>
    toBuilderPart(
      { ...shape, materialId: resolveMatId(shape.materialId) },
      index,
      spec.grid.unit_meters,
      diagnostics,
    ),
  );
  const instanceOffsets = buildCloneInstanceOffsets(
    finalOp,
    layoutOrigin,
    spec.placement.offset,
  );
  const instances = instanceOffsets.map((offset, index) => ({
    instance_id: `instance_${index}`,
    anchor_mode: spec.placement.mode,
    reference_object: spec.placement.reference_object ?? null,
    relation: spec.placement.relation ?? null,
    offset: scaleVector(offset, spec.grid.unit_meters),
  }));
  const explicitPlacementOffset = vectorLength(
    scaleVector(spec.placement.offset, spec.grid.unit_meters),
  );
  const clonePlacementOffset = vectorLength(
    scaleVector(getClonePlacementDelta(finalOp, layoutOrigin), spec.grid.unit_meters),
  );

  return {
    parts,
    instances,
    placementOffsetMeters:
      explicitPlacementOffset > 0 ? explicitPlacementOffset : clonePlacementOffset,
  };
}

function shapeFromBox(op: AddBoxOp): Shape {
  return {
    id: op.op_id,
    kind: "box",
    center: [...op.position],
    size: [...op.size],
    materialId: op.material_id,
    tags: [...(op.tags ?? [])],
  };
}

function shapeFromSphere(op: AddSphereOp): Shape {
  return {
    id: op.op_id,
    kind: "sphere",
    center: [...op.center],
    radius: op.radius,
    materialId: op.material_id,
    tags: [...(op.tags ?? [])],
  };
}

function shapeFromLine(op: AddLineOp): Shape {
  return {
    id: op.op_id,
    kind: "line",
    from: [...op.from],
    to: [...op.to],
    radius: op.radius,
    shape: op.shape ?? "rounded",
    materialId: op.material_id,
    tags: [...(op.tags ?? [])],
  };
}

function cloneShapes(
  shapes: Shape[],
  op: CloneRegionOp,
  diagnostics: string[],
): Shape[] {
  const selected = shapes.filter((shape) => matchesRegion(shape, op.target));

  if (!selected.length) {
    diagnostics.push(`clone_region ${op.op_id} matched no shapes`);
    return [];
  }

  if (op.copies.count === 0) return [];

  if (op.copies.type === "linear") {
    const { step } = op.copies;
    return Array.from({ length: op.copies.count }, (_, index) =>
      selected.map((shape) =>
        translateShape(
          duplicateShape(shape, `${shape.id}::clone_${index + 1}`),
          scaleVector(step, index + 1),
        ),
      ),
    ).flat();
  }

  const { axis, center, count } = op.copies;
  return Array.from({ length: op.copies.count }, (_, index) => {
    const angle = (Math.PI * 2 * (index + 1)) / (count + 1);
    return selected.map((shape) =>
      rotateShapeByAngle(
        duplicateShape(shape, `${shape.id}::radial_${index + 1}`),
        axis,
        angle,
        center,
      ),
    );
  }).flat();
}

function getLayoutOrigin(shapes: Shape[], op: CloneRegionOp): VoxelVector3 {
  const bounds = getCombinedBounds(shapes);
  const center = midpoint(bounds.min, bounds.max);

  if (op.copies.type === "radial") {
    switch (op.copies.axis) {
      case "x":
        return [op.copies.center[0], center[1], center[2]];
      case "y":
        return [center[0], op.copies.center[1], center[2]];
      case "z":
        return [center[0], center[1], op.copies.center[2]];
      default:
        return center;
    }
  }

  return [center[0], 0, center[2]];
}

function getClonePlacementDelta(
  op: CloneRegionOp,
  layoutOrigin: VoxelVector3,
): VoxelVector3 {
  if (op.copies.type !== "radial") {
    return layoutOrigin;
  }

  return subtractVectors(layoutOrigin, op.copies.center);
}

function buildCloneInstanceOffsets(
  op: CloneRegionOp,
  layoutOrigin: VoxelVector3,
  placementOffset: VoxelVector3,
): VoxelVector3[] {
  const { copies } = op;

  if (copies.count === 0) {
    return [addVectors(placementOffset, layoutOrigin)];
  }

  if (copies.type === "linear") {
    return Array.from({ length: copies.count + 1 }, (_, index) =>
      addVectors(
        placementOffset,
        addVectors(layoutOrigin, scaleVector(copies.step, index)),
      ),
    );
  }

  return Array.from({ length: copies.count + 1 }, (_, index) => {
    if (index === 0) {
      return addVectors(placementOffset, layoutOrigin);
    }

    const angle = (-Math.PI * 2 * index) / (copies.count + 1);
    return addVectors(
      placementOffset,
      rotatePoint(layoutOrigin, copies.axis, angle, copies.center),
    );
  });
}

function rotateShape(shape: Shape, op: RotateRegionOp): Shape {
  const center = op.rotate.center ?? [0, 0, 0];

  switch (shape.kind) {
    case "box":
      return {
        ...shape,
        center: rotatePoint90(shape.center, op.rotate.axis, op.rotate.turns, center),
        size: rotateBoxSize(shape.size, op.rotate.axis, op.rotate.turns),
      };
    case "sphere":
      return {
        ...shape,
        center: rotatePoint90(shape.center, op.rotate.axis, op.rotate.turns, center),
      };
    case "line":
      return {
        ...shape,
        from: rotatePoint90(shape.from, op.rotate.axis, op.rotate.turns, center),
        to: rotatePoint90(shape.to, op.rotate.axis, op.rotate.turns, center),
      };
    default:
      return shape;
  }
}

function rotateShapeByAngle(
  shape: Shape,
  axis: "x" | "y" | "z",
  angle: number,
  center: VoxelVector3,
): Shape {
  switch (shape.kind) {
    case "box":
      return {
        ...shape,
        center: rotatePoint(shape.center, axis, angle, center),
      };
    case "sphere":
      return {
        ...shape,
        center: rotatePoint(shape.center, axis, angle, center),
      };
    case "line":
      return {
        ...shape,
        from: rotatePoint(shape.from, axis, angle, center),
        to: rotatePoint(shape.to, axis, angle, center),
      };
    default:
      return shape;
  }
}

function translateShape(shape: Shape, delta: VoxelVector3): Shape {
  switch (shape.kind) {
    case "box":
      return { ...shape, center: addVectors(shape.center, delta) };
    case "sphere":
      return { ...shape, center: addVectors(shape.center, delta) };
    case "line":
      return {
        ...shape,
        from: addVectors(shape.from, delta),
        to: addVectors(shape.to, delta),
      };
    default:
      return shape;
  }
}

function duplicateShape(shape: Shape, id: string): Shape {
  switch (shape.kind) {
    case "box":
      return { ...shape, id, center: [...shape.center], size: [...shape.size] };
    case "sphere":
      return { ...shape, id, center: [...shape.center] };
    case "line":
      return { ...shape, id, from: [...shape.from], to: [...shape.to] };
    default:
      return shape;
  }
}

function matchesRegion(shape: Shape, target: RegionSelector): boolean {
  if (target.by_tags?.length) {
    const hasAllTags = target.by_tags.every((tag) => shape.tags.includes(tag));
    if (!hasAllTags) return false;
  }

  if (target.by_material_ids?.length) {
    if (!target.by_material_ids.includes(shape.materialId)) return false;
  }

  if (target.by_bounds) {
    const bounds = getShapeBounds(shape);
    if (
      bounds.max[0] < target.by_bounds.min[0] ||
      bounds.min[0] > target.by_bounds.max[0] ||
      bounds.max[1] < target.by_bounds.min[1] ||
      bounds.min[1] > target.by_bounds.max[1] ||
      bounds.max[2] < target.by_bounds.min[2] ||
      bounds.min[2] > target.by_bounds.max[2]
    ) {
      return false;
    }
  }

  return true;
}

function getCombinedBounds(shapes: Shape[]) {
  const first = shapes[0];
  if (!first) {
    return {
      min: [0, 0, 0] as VoxelVector3,
      max: [0, 0, 0] as VoxelVector3,
    };
  }

  const rest = shapes.slice(1);
  const initial = getShapeBounds(first);

  return rest.reduce(
    (bounds, shape) => {
      const shapeBounds = getShapeBounds(shape);
      return {
        min: [
          Math.min(bounds.min[0], shapeBounds.min[0]),
          Math.min(bounds.min[1], shapeBounds.min[1]),
          Math.min(bounds.min[2], shapeBounds.min[2]),
        ] as VoxelVector3,
        max: [
          Math.max(bounds.max[0], shapeBounds.max[0]),
          Math.max(bounds.max[1], shapeBounds.max[1]),
          Math.max(bounds.max[2], shapeBounds.max[2]),
        ] as VoxelVector3,
      };
    },
    {
      min: [...initial.min] as VoxelVector3,
      max: [...initial.max] as VoxelVector3,
    },
  );
}

function getShapeBounds(shape: Shape) {
  switch (shape.kind) {
    case "box": {
      const half = shape.size.map((value) => value / 2) as VoxelVector3;
      return {
        min: subtractVectors(shape.center, half),
        max: addVectors(shape.center, half),
      };
    }
    case "sphere":
      return {
        min: [
          shape.center[0] - shape.radius,
          shape.center[1] - shape.radius,
          shape.center[2] - shape.radius,
        ] as VoxelVector3,
        max: [
          shape.center[0] + shape.radius,
          shape.center[1] + shape.radius,
          shape.center[2] + shape.radius,
        ] as VoxelVector3,
      };
    case "line":
      return {
        min: [
          Math.min(shape.from[0], shape.to[0]) - shape.radius,
          Math.min(shape.from[1], shape.to[1]) - shape.radius,
          Math.min(shape.from[2], shape.to[2]) - shape.radius,
        ] as VoxelVector3,
        max: [
          Math.max(shape.from[0], shape.to[0]) + shape.radius,
          Math.max(shape.from[1], shape.to[1]) + shape.radius,
          Math.max(shape.from[2], shape.to[2]) + shape.radius,
        ] as VoxelVector3,
      };
    default:
      return {
        min: [0, 0, 0] as VoxelVector3,
        max: [0, 0, 0] as VoxelVector3,
      };
  }
}

function toBuilderPart(
  shape: Shape,
  index: number,
  unitMeters: number,
  diagnostics: string[],
): BuilderPart {
  switch (shape.kind) {
    case "box":
      return {
        part_id: shape.id || `part_${index}`,
        primitive: "cube",
        material: shape.materialId,
        dimensions: scaleVector(shape.size, unitMeters),
        modifiers: [...shape.tags],
        local_position: scaleVector(shape.center, unitMeters),
        local_rotation: [0, 0, 0],
        local_scale: [1, 1, 1],
      };
    case "sphere": {
      const diameter = shape.radius * 2 * unitMeters;
      return {
        part_id: shape.id || `part_${index}`,
        primitive: "blob",
        material: shape.materialId,
        dimensions: [diameter, diameter, diameter],
        modifiers: [...shape.tags],
        local_position: scaleVector(shape.center, unitMeters),
        local_rotation: [0, 0, 0],
        local_scale: [1, 1, 1],
      };
    }
    case "line":
      return lineToBuilderPart(shape, index, unitMeters, diagnostics);
    default:
      throw new Error(`unsupported shape kind ${(shape as { kind: string }).kind}`);
  }
}

function lineToBuilderPart(
  shape: Extract<Shape, { kind: "line" }>,
  index: number,
  unitMeters: number,
  diagnostics: string[],
): BuilderPart {
  const delta = subtractVectors(shape.to, shape.from);
  const center = midpoint(shape.from, shape.to);
  const diameter = shape.radius * 2 * unitMeters;

  if (isAxisAligned(delta, "y")) {
    return {
      part_id: shape.id || `part_${index}`,
      primitive: shape.shape === "rounded" ? "column" : "cube",
      material: shape.materialId,
      dimensions: [diameter, Math.abs(delta[1]) * unitMeters, diameter],
      modifiers: [...shape.tags],
      local_position: scaleVector(center, unitMeters),
      local_rotation: [0, 0, 0],
      local_scale: [1, 1, 1],
    };
  }

  if (isAxisAligned(delta, "x")) {
    return {
      part_id: shape.id || `part_${index}`,
      primitive: "cube",
      material: shape.materialId,
      dimensions: [Math.abs(delta[0]) * unitMeters, diameter, diameter],
      modifiers: [...shape.tags],
      local_position: scaleVector(center, unitMeters),
      local_rotation: [0, 0, 0],
      local_scale: [1, 1, 1],
    };
  }

  if (isAxisAligned(delta, "z")) {
    return {
      part_id: shape.id || `part_${index}`,
      primitive: "cube",
      material: shape.materialId,
      dimensions: [diameter, diameter, Math.abs(delta[2]) * unitMeters],
      modifiers: [...shape.tags],
      local_position: scaleVector(center, unitMeters),
      local_rotation: [0, 0, 0],
      local_scale: [1, 1, 1],
    };
  }

  diagnostics.push(
    `line ${shape.id} is not axis-aligned; falling back to bounds box in current compiler target`,
  );
  const bounds = getShapeBounds(shape);
  return {
    part_id: shape.id || `part_${index}`,
    primitive: "cube",
    material: shape.materialId,
    dimensions: scaleVector(subtractVectors(bounds.max, bounds.min), unitMeters),
    modifiers: [...shape.tags],
    local_position: scaleVector(center, unitMeters),
    local_rotation: [0, 0, 0],
    local_scale: [1, 1, 1],
  };
}

function rotateBoxSize(
  size: VoxelVector3,
  axis: "x" | "y" | "z",
  turns: 1 | 2 | 3,
): VoxelVector3 {
  if (turns % 2 === 0) return [...size];

  switch (axis) {
    case "x":
      return [size[0], size[2], size[1]];
    case "y":
      return [size[2], size[1], size[0]];
    case "z":
      return [size[1], size[0], size[2]];
    default:
      return [...size];
  }
}

function rotatePoint90(
  point: VoxelVector3,
  axis: "x" | "y" | "z",
  turns: 1 | 2 | 3,
  center: VoxelVector3,
): VoxelVector3 {
  let rotated = [...point] as VoxelVector3;
  for (let index = 0; index < turns; index += 1) {
    rotated = rotatePoint(rotated, axis, Math.PI / 2, center);
    rotated = rotated.map((value) => roundToGrid(value)) as VoxelVector3;
  }
  return rotated;
}

function rotatePoint(
  point: VoxelVector3,
  axis: "x" | "y" | "z",
  angle: number,
  center: VoxelVector3,
): VoxelVector3 {
  const translated = subtractVectors(point, center);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  switch (axis) {
    case "x":
      return addVectors(center, [
        translated[0],
        translated[1] * cos - translated[2] * sin,
        translated[1] * sin + translated[2] * cos,
      ]);
    case "y":
      return addVectors(center, [
        translated[0] * cos + translated[2] * sin,
        translated[1],
        -translated[0] * sin + translated[2] * cos,
      ]);
    case "z":
      return addVectors(center, [
        translated[0] * cos - translated[1] * sin,
        translated[0] * sin + translated[1] * cos,
        translated[2],
      ]);
    default:
      return [...point];
  }
}

function midpoint(a: VoxelVector3, b: VoxelVector3): VoxelVector3 {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];
}

function scaleVector(
  vector: VoxelVector3,
  factor: number,
): VoxelVector3 {
  return [
    vector[0] * factor,
    vector[1] * factor,
    vector[2] * factor,
  ];
}

function addVectors(a: VoxelVector3, b: VoxelVector3): VoxelVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtractVectors(a: VoxelVector3, b: VoxelVector3): VoxelVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vectorLength(vector: VoxelVector3): number {
  return Math.sqrt(
    vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2,
  );
}

function isAxisAligned(
  delta: VoxelVector3,
  axis: "x" | "y" | "z",
): boolean {
  const [x, y, z] = delta.map((value) => Math.abs(value));
  switch (axis) {
    case "x":
      return x > 0 && y === 0 && z === 0;
    case "y":
      return y > 0 && x === 0 && z === 0;
    case "z":
      return z > 0 && x === 0 && y === 0;
    default:
      return false;
  }
}

function roundToGrid(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

// When a material declares a color_hint (e.g. material_id "jelly", color_hint "yellow"),
// use the hint as the effective material name so the renderer can match the intended color.
function buildMaterialColorResolver(
  materials: VoxelBuilderSpec["materials"],
): (id: string) => string {
  const map = new Map<string, string>();
  for (const m of materials) {
    if (m.color_hint) {
      map.set(m.material_id, m.color_hint);
    }
  }
  return (id: string) => map.get(id) ?? id;
}
