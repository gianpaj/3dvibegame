import type {
  AuthorityObject,
  AuthorityTransform,
  BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

export interface ObjectCopyTemplate {
  originalObjectId: string;
  sourceSpecJson?: string;
  builderSpecJson: string;
  builderSpec: BuilderSpec;
  category: string;
  sizeTier: string;
  transform: AuthorityTransform;
  copiedAt: number;
}

export interface ObjectPastePoint {
  x: number;
  y: number;
  z: number;
}

const pasteSpacing = 2.5;

export function canCopyObject(
  object: AuthorityObject | null,
  localPlayerId: string | null,
) {
  if (!object) return false;
  if (object.state === "public") return true;
  if (object.state === "grace") return object.grace_owner_id === localPlayerId;
  if (object.state === "edit_locked") return object.lock_owner_id === localPlayerId;
  return false;
}

export function createObjectCopyTemplate({
  object,
  localPlayerId,
  sourceSpecJson,
  builderSpecJson,
  copiedAt = Date.now(),
}: {
  object: AuthorityObject;
  localPlayerId: string | null;
  sourceSpecJson?: string;
  builderSpecJson?: string;
  copiedAt?: number;
}): ObjectCopyTemplate {
  if (!canCopyObject(object, localPlayerId)) {
    throw new Error("That object cannot be copied right now.");
  }

  return {
    originalObjectId: object.object_id,
    sourceSpecJson,
    builderSpecJson: builderSpecJson ?? JSON.stringify(object.builder_spec),
    builderSpec: cloneBuilderSpec(object.builder_spec),
    category: object.builder_spec.object_category,
    sizeTier: object.builder_spec.size_tier,
    transform: cloneTransform(object.transform),
    copiedAt,
  };
}

export function pastePositionForTemplate(
  template: ObjectCopyTemplate,
  pasteCount: number,
  fallback: ObjectPastePoint,
): ObjectPastePoint {
  const [x, y, z] = template.transform.position;
  if ([x, y, z].every(Number.isFinite)) {
    return {
      x: x + pasteSpacing * (pasteCount + 1),
      y,
      z,
    };
  }
  return fallback;
}

export function cloneBuilderSpec(builderSpec: BuilderSpec): BuilderSpec {
  return JSON.parse(JSON.stringify(builderSpec)) as BuilderSpec;
}

function cloneTransform(transform: AuthorityTransform): AuthorityTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}
