import type {
  AuthorityObjectState,
  AuthorityWorld,
  BuilderOperation,
  BuilderRelation,
  BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type { World, WorldObject } from "./module_bindings/types";

export function mapBackendAuthorityWorld(
  world: World,
  worldObjects: Iterable<WorldObject>,
): AuthorityWorld {
  const objects = Array.from(worldObjects)
    .filter((object) => object.worldId === world.worldId)
    .map(mapWorldObject)
    .filter(isPresent)
    .sort(compareAuthorityObjects);

  return {
    world_id: world.worldId.toString(),
    settings: {
      visibility: world.visibility === "private" ? "private" : "public",
      destructive_edits_enabled: world.destructiveEditsEnabled,
      object_cooldown_seconds: world.objectCooldownSeconds,
      protected_spawn_enabled: true,
    },
    jobs: [],
    objects,
    events: [],
  };
}

function mapWorldObject(object: WorldObject): AuthorityWorld["objects"][number] | null {
  const state = mapObjectState(object.state);
  const builderSpec = parseBuilderSpec(object.builderSpecJson);

  if (!state || !builderSpec) {
    return null;
  }

  return {
    object_id: object.objectId,
    world_id: object.worldId.toString(),
    state,
    version: object.version,
    created_by: object.createdBy.toHexString(),
    latest_editor: object.latestEditor.toHexString(),
    grace_owner_id: object.graceOwner?.toHexString() ?? null,
    lock_owner_id: object.lockOwner?.toHexString() ?? null,
    builder_spec: builderSpec,
    transform: {
      position: [object.positionX, object.positionY, object.positionZ],
      rotation: [object.rotationX, object.rotationY, object.rotationZ],
      scale: [object.scaleX, object.scaleY, object.scaleZ],
    },
    cooldown_remaining_seconds: object.cooldownRemainingSeconds,
    grace_remaining_seconds: object.graceRemainingSeconds,
  };
}

function mapObjectState(state: string): AuthorityObjectState | null {
  switch (state) {
    case "draft":
    case "grace":
    case "public":
    case "edit_locked":
    case "cooldown":
    case "archived":
      return state;
    case "deleted":
    default:
      return null;
  }
}

function compareAuthorityObjects(
  a: AuthorityWorld["objects"][number],
  b: AuthorityWorld["objects"][number],
) {
  return a.object_id.localeCompare(b.object_id);
}

function parseBuilderSpec(builderSpecJson: string): BuilderSpec | null {
  try {
    const parsed: unknown = JSON.parse(builderSpecJson);
    return isBuilderSpec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBuilderSpec(value: unknown): value is BuilderSpec {
  if (!isRecord(value)) return false;

  return (
    typeof value.builder_version === "string" &&
    typeof value.request_id === "string" &&
    typeof value.intent_id === "string" &&
    isBuilderOperation(value.operation) &&
    optionalStringOrNull(value.target_object_id) &&
    optionalIntegerOrNull(value.base_object_version) &&
    typeof value.object_category === "string" &&
    typeof value.size_tier === "string" &&
    Array.isArray(value.parts) &&
    value.parts.length > 0 &&
    value.parts.every(isBuilderPart) &&
    Array.isArray(value.instances) &&
    value.instances.every(isBuilderInstance) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isRecord) &&
    isStringArray(value.materials) &&
    isStringArray(value.behaviors) &&
    isBuilderPlacement(value.placement) &&
    isBuilderComplexity(value.complexity) &&
    isStringArray(value.diagnostics)
  );
}

function isBuilderOperation(value: unknown): value is BuilderOperation {
  return value === "create" || value === "refine" || value === "remix";
}

function isBuilderPart(value: unknown): value is BuilderSpec["parts"][number] {
  if (!isRecord(value)) return false;

  return (
    typeof value.part_id === "string" &&
    typeof value.primitive === "string" &&
    typeof value.material === "string" &&
    isNumberTuple(value.dimensions) &&
    isStringArray(value.modifiers) &&
    optionalNumberTuple(value.local_position) &&
    optionalNumberTuple(value.local_rotation) &&
    optionalNumberTuple(value.local_scale)
  );
}

function isBuilderInstance(value: unknown): value is BuilderSpec["instances"][number] {
  if (!isRecord(value)) return false;

  return (
    typeof value.instance_id === "string" &&
    typeof value.anchor_mode === "string" &&
    optionalStringOrNull(value.reference_object) &&
    optionalBuilderRelation(value.relation) &&
    isNumberTuple(value.offset)
  );
}

function isBuilderPlacement(value: unknown): value is BuilderSpec["placement"] {
  if (!isRecord(value)) return false;

  return (
    typeof value.mode === "string" &&
    optionalStringOrNull(value.reference_object) &&
    optionalBuilderRelation(value.relation) &&
    optionalNumberOrNull(value.offset_meters)
  );
}

function isBuilderComplexity(value: unknown): value is BuilderSpec["complexity"] {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.part_count) &&
    isNonNegativeInteger(value.instance_count) &&
    isNonNegativeInteger(value.behavior_count)
  );
}

function optionalBuilderRelation(value: unknown): value is BuilderRelation | null | undefined {
  return (
    value === undefined ||
    value === null ||
    value === "left_of" ||
    value === "right_of" ||
    value === "behind" ||
    value === "in_front_of" ||
    value === "around"
  );
}

function optionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function optionalIntegerOrNull(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || Number.isInteger(value);
}

function optionalNumberOrNull(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || Number.isFinite(value);
}

function optionalNumberTuple(value: unknown): value is [number, number, number] | undefined {
  return value === undefined || isNumberTuple(value);
}

function isNumberTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
