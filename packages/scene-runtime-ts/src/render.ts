import type {
    BoundsHint,
    NormalizedScenePlan,
    ObjectIntent,
    PrimitiveNode,
    RenderDraftSpec,
    TransformSpec,
    WorldAnchor,
} from "./contracts";

const boundsBySizeTier: Record<string, [number, number, number]> = {
  tiny: [0.5, 0.5, 0.5],
  small: [1, 1, 1],
  medium: [2, 2, 2],
  large: [4, 3, 4],
  huge: [6, 6, 6],
};

export function buildRenderDrafts(plan: NormalizedScenePlan): RenderDraftSpec[] {
  if (plan.plan_kind !== "object_intent") return [];

  return plan.intents.map((intent) => {
    const warnings: string[] = [];
    const primitiveNodes = buildPrimitiveNodes(intent, warnings);
    return {
      draft_id: `${intent.intent_id}::draft`,
      request_id: plan.request_id,
      intent_id: intent.intent_id,
      display_name: displayName(intent.category, primitiveNodes.length),
      primitive_nodes: primitiveNodes,
      world_anchor: buildWorldAnchor(intent.transform_hints, warnings),
      bounds_hint: buildBoundsHint(intent.size_tier),
      preview_materials: previewMaterials(intent.material_palette),
      animation_presets: intent.behavior_presets,
      warnings,
    };
  });
}

function buildWorldAnchor(
  transformHints: TransformSpec | null | undefined,
  warnings: string[],
): WorldAnchor {
  const position = transformHints?.position ?? null;

  if (!position) {
    warnings.push("missing position transform hints; defaulting to origin anchor");
    return { mode: "absolute", absolute: [0, 0, 0] };
  }

  return {
    mode: position.mode ?? "absolute",
    reference_object: position.reference_object,
    relation: position.relation,
    offset_meters: position.offset_meters,
    absolute: position.absolute,
  };
}

function buildPrimitiveNodes(
  intent: ObjectIntent,
  warnings: string[],
): PrimitiveNode[] {
  let count = intent.instance_count || 1;
  let layoutType: string | undefined;

  if (intent.layout_hint) {
    count = Math.max(count, intent.layout_hint.count ?? 1);
    layoutType = intent.layout_hint.layout_type ?? undefined;
  }

  if (count > 1 && !layoutType) {
    warnings.push(
      "grouped instances have no explicit layout; preview uses indexed placeholders",
    );
  }

  const primitive =
    (intent.parts[0]?.primitive as string | undefined) ?? "cube";
  const material = typeof intent.material_palette?.dominant === "string"
    ? intent.material_palette.dominant
    : undefined;

  return Array.from({ length: count }, (_, index) => {
    const transform: Record<string, unknown> = { instance_index: index };
    if (layoutType === "triangle") {
      transform.polar_angle_degrees = index * 120;
    }
    return {
      primitive,
      transform,
      material,
      metadata: { category: intent.category },
    };
  });
}

function buildBoundsHint(sizeTier?: string | null): BoundsHint | undefined {
  if (!sizeTier) return undefined;
  const size = boundsBySizeTier[sizeTier];
  return size ? { size } : undefined;
}

function previewMaterials(
  materialPalette?: Record<string, unknown> | null,
): string[] {
  if (!materialPalette) return [];
  return Object.values(materialPalette)
    .filter((value): value is string => typeof value === "string")
    .map(String);
}

function displayName(category: string, nodeCount: number): string {
  const label = category.replaceAll("_", " ");
  if (nodeCount <= 1) return capitalize(label);
  return `${nodeCount} ${capitalize(label)}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
