import type {
  ActionType,
  LayoutHint,
  NormalizedScenePlan,
  ObjectIntent,
  PlanningRequest,
  SceneAction,
  ScenePlanningResponse,
} from "./contracts";

const createActions = new Set<ActionType>(["add_object", "spawn_layout"]);
const refineActions = new Set<ActionType>([
  "move_object",
  "replace_object",
  "set_color",
  "set_material",
]);

const sizeByCategory: Record<string, string> = {
  barrel: "small",
  campfire: "small",
  tree: "medium",
  house: "large",
  cabin: "large",
};

const primitiveByCategory: Record<string, string> = {
  barrel: "column",
  campfire: "blob",
  house: "cube",
  cabin: "cube",
  tree: "column",
};

export function normalizeResponse(
  request: PlanningRequest,
  response: ScenePlanningResponse,
): NormalizedScenePlan {
  if (response.response_type === "clarification_request") {
    return {
      plan_version: "0.1",
      request_id: request.request_id,
      plan_kind: "clarification",
      source_response_type: response.response_type,
      uncertainty: response.uncertainty,
      intents: [],
      clarification: response.clarification ?? undefined,
      diagnostics: [],
    };
  }

  if (response.response_type === "refusal") {
    return {
      plan_version: "0.1",
      request_id: request.request_id,
      plan_kind: "refusal",
      source_response_type: response.response_type,
      uncertainty: response.uncertainty,
      intents: [],
      refusal: response.refusal ?? undefined,
      diagnostics: [],
    };
  }

  const diagnostics: string[] = [];
  const intents = (response.actions ?? [])
    .map((action, index) => normalizeAction(request, action, index, diagnostics))
    .filter((intent): intent is ObjectIntent => intent !== null);

  return {
    plan_version: "0.1",
    request_id: request.request_id,
    plan_kind: "object_intent",
    source_response_type: response.response_type,
    uncertainty: response.uncertainty,
    intents: mergeRepeatedCreateIntents(intents, diagnostics),
    diagnostics,
  };
}

function normalizeAction(
  request: PlanningRequest,
  action: SceneAction,
  index: number,
  diagnostics: string[],
): ObjectIntent | null {
  const operation = mapActionToOperation(action.action_type);
  if (!operation) {
    diagnostics.push(
      `unsupported action_type for normalization: ${action.action_type}`,
    );
    return null;
  }

  const category = action.object_spec?.category ?? "unknown";
  if (category === "unknown") {
    diagnostics.push(`action ${index} missing object category; normalized as unknown`);
  }

  const layoutHint = buildLayoutHint(action);
  if (action.action_type === "spawn_layout" && !layoutHint) {
    diagnostics.push(`action ${index} is spawn_layout but no layout metadata was provided`);
  }

  return {
    intent_id: `${request.request_id}::intent_${index}`,
    operation,
    target_object_id:
      operation === "create" ? undefined : (request.target_object_id ?? action.target ?? undefined),
    base_object_version:
      operation === "create" ? undefined : (request.base_object_version ?? undefined),
    category,
    size_tier: sizeByCategory[category],
    parts:
      operation === "create"
        ? [
            {
              part_id: "main",
              primitive: primitiveByCategory[category] ?? "cube",
              category,
              variant: action.object_spec?.variant ?? null,
            },
          ]
        : [],
    material_palette: buildMaterialPalette(action),
    behavior_presets: [],
    transform_hints: action.transform ?? undefined,
    style_tags: [action.object_spec?.style, action.object_spec?.variant].filter(
      Boolean,
    ) as string[],
    instance_count: resolveInstanceCount(layoutHint),
    layout_hint: layoutHint ?? undefined,
    source_actions: [action.action_type],
  };
}

function mapActionToOperation(actionType: ActionType): ObjectIntent["operation"] | null {
  if (createActions.has(actionType)) return "create";
  if (refineActions.has(actionType)) return "refine";
  return null;
}

function buildMaterialPalette(action: SceneAction): Record<string, unknown> | undefined {
  if (!action.attributes) return undefined;
  const dominant = action.attributes.material ?? action.attributes.color ?? undefined;
  const palette: Record<string, unknown> = {};
  if (dominant) palette.dominant = dominant;
  if (action.attributes.color && action.attributes.material) {
    palette.color = action.attributes.color;
  }
  return Object.keys(palette).length > 0 ? palette : undefined;
}

function buildLayoutHint(action: SceneAction): LayoutHint | null {
  const attributes = action.attributes;
  if (!attributes) return null;
  if (!attributes.layout && (!attributes.count || attributes.count <= 1)) return null;

  return {
    layout_type: attributes.layout ?? undefined,
    count: attributes.count ?? undefined,
    reference_object: action.transform?.position?.reference_object ?? undefined,
    relation: action.transform?.position?.relation ?? undefined,
    metadata: {
      offset_meters: action.transform?.position?.offset_meters ?? undefined,
    },
  };
}

function resolveInstanceCount(layoutHint: LayoutHint | null): number {
  return layoutHint?.count && layoutHint.count > 0 ? layoutHint.count : 1;
}

function mergeRepeatedCreateIntents(
  intents: ObjectIntent[],
  diagnostics: string[],
): ObjectIntent[] {
  const grouped = new Map<string, ObjectIntent>();
  const ordered: ObjectIntent[] = [];

  for (const intent of intents) {
    if (!isMergeableRepeatedCreate(intent)) {
      ordered.push(intent);
      continue;
    }

    const key = JSON.stringify({
      ...intent,
      intent_id: undefined,
      instance_count: undefined,
      source_actions: undefined,
    });
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, intent);
      ordered.push(intent);
      continue;
    }

    existing.instance_count += intent.instance_count;
    existing.source_actions.push(...intent.source_actions);
    diagnostics.push(
      `merged repeated create intent ${intent.intent_id} into ${existing.intent_id}`,
    );
  }

  return ordered;
}

function isMergeableRepeatedCreate(intent: ObjectIntent): boolean {
  return (
    intent.operation === "create" &&
    !intent.target_object_id &&
    !intent.layout_hint
  );
}
