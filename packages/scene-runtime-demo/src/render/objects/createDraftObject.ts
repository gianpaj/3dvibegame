import type { ObjectIntent, RenderDraftSpec } from "@3dvibegame/scene-runtime-ts";
import * as THREE from "three";

interface DraftObjectConfig {
  draft: RenderDraftSpec;
  intent?: ObjectIntent;
  resolveAnchor(referenceId?: string | null): THREE.Vector3 | null;
}

export function createDraftObject({
  draft,
  intent,
  resolveAnchor,
}: DraftObjectConfig) {
  const group = new THREE.Group();
  group.name = draft.display_name;

  const focusAccumulator = new THREE.Vector3();

  draft.primitive_nodes.forEach((node, index) => {
    const nodeMesh = createNodeMesh({
      draft,
      intent,
      node,
      index,
      resolveAnchor,
    });
    focusAccumulator.add(nodeMesh.position);
    group.add(nodeMesh);
  });

  const focusPoint =
    draft.primitive_nodes.length > 0
      ? focusAccumulator.multiplyScalar(1 / draft.primitive_nodes.length)
      : resolveAnchor(draft.world_anchor.reference_object) ?? new THREE.Vector3();

  return { group, focusPoint };
}

function createNodeMesh({
  draft,
  intent,
  node,
  index,
  resolveAnchor,
}: {
  draft: RenderDraftSpec;
  intent?: ObjectIntent;
  node: RenderDraftSpec["primitive_nodes"][number];
  index: number;
  resolveAnchor(referenceId?: string | null): THREE.Vector3 | null;
}) {
  const category =
    typeof node.metadata?.category === "string"
      ? node.metadata.category
      : intent?.category;
  const size = resolveSize(draft);
  const nodeGroup = buildCategoryShape(category, node.primitive, node.material, size);
  nodeGroup.position.copy(resolveNodePosition(draft, node, index, resolveAnchor));
  nodeGroup.rotation.y = resolveNodeRotation(draft, node);
  nodeGroup.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return nodeGroup;
}

function resolveNodePosition(
  draft: RenderDraftSpec,
  node: RenderDraftSpec["primitive_nodes"][number],
  index: number,
  resolveAnchor: (referenceId?: string | null) => THREE.Vector3 | null,
) {
  const anchor = resolveAnchorBase(draft, resolveAnchor);
  const offset = new THREE.Vector3();
  const relation = draft.world_anchor.relation;
  const radius = draft.world_anchor.offset_meters ?? 2;

  if (draft.world_anchor.mode === "relative") {
    switch (relation) {
      case "left_of":
        offset.x -= radius;
        break;
      case "right_of":
        offset.x += radius;
        break;
      case "behind":
        offset.z += radius;
        break;
      case "in_front_of":
        offset.z -= radius;
        break;
      case "around": {
        const degrees = asNumber(node.transform.polar_angle_degrees) ?? index * 120;
        const radians = (degrees * Math.PI) / 180;
        offset.set(Math.cos(radians) * radius, 0, Math.sin(radians) * radius);
        break;
      }
      default:
        break;
    }
  }

  if (relation !== "around" && draft.primitive_nodes.length > 1) {
    offset.x += index * 1.45 - ((draft.primitive_nodes.length - 1) * 1.45) / 2;
  }

  return anchor.add(offset);
}

function resolveAnchorBase(
  draft: RenderDraftSpec,
  resolveAnchor: (referenceId?: string | null) => THREE.Vector3 | null,
) {
  if (
    draft.world_anchor.mode === "absolute" &&
    Array.isArray(draft.world_anchor.absolute) &&
    draft.world_anchor.absolute.length >= 3
  ) {
    return new THREE.Vector3(
      draft.world_anchor.absolute[0],
      draft.world_anchor.absolute[1],
      draft.world_anchor.absolute[2],
    );
  }

  const referenceAnchor = resolveAnchor(draft.world_anchor.reference_object);
  return referenceAnchor ? referenceAnchor.clone() : new THREE.Vector3();
}

function resolveNodeRotation(
  draft: RenderDraftSpec,
  node: RenderDraftSpec["primitive_nodes"][number],
) {
  if (draft.world_anchor.relation === "around") {
    const degrees = asNumber(node.transform.polar_angle_degrees) ?? 0;
    return ((degrees + 90) * Math.PI) / 180;
  }

  return 0;
}

function resolveSize(draft: RenderDraftSpec) {
  const [width = 1.2, height = 1.2, depth = 1.2] = draft.bounds_hint?.size ?? [];
  return { width, height, depth };
}

function buildCategoryShape(
  category: string | undefined,
  primitive: string,
  materialName: string | null | undefined,
  size: { width: number; height: number; depth: number },
) {
  switch (category) {
    case "barrel":
      return createBarrelDraft(materialName, size);
    case "tree":
      return createTreeDraft(size);
    case "house":
    case "cabin":
      return createHouseDraft(materialName, size);
    default:
      return createPrimitiveDraft(primitive, materialName, size);
  }
}

function createBarrelDraft(
  materialName: string | null | undefined,
  size: { width: number; height: number; depth: number },
) {
  const group = new THREE.Group();
  const bodyMaterial = createMaterial(materialName ?? "wood");
  const bandMaterial = createMaterial("#49535a");
  const bodyRadius = Math.max(size.width * 0.34, 0.28);
  const bodyHeight = Math.max(size.height * 0.9, 0.75);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyRadius, bodyRadius * 1.08, bodyHeight, 18),
    bodyMaterial,
  );
  body.position.y = bodyHeight / 2;
  group.add(body);

  [-0.22, 0.22].forEach((offsetY) => {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyRadius * 1.03, bodyRadius * 1.03, 0.08, 18),
      bandMaterial,
    );
    band.position.y = body.position.y + offsetY * bodyHeight;
    group.add(band);
  });

  return group;
}

function createTreeDraft(size: { width: number; height: number; depth: number }) {
  const group = new THREE.Group();

  const trunkHeight = Math.max(size.height * 0.9, 1.5);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * size.width, 0.24 * size.width, trunkHeight, 12),
    createMaterial("wood"),
  );
  trunk.position.y = trunkHeight / 2;
  group.add(trunk);

  const canopyMaterial = createMaterial("pine_green");
  [0, 1, 2].forEach((level) => {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(size.width * (0.75 - level * 0.12), size.height * 0.9, 8),
      canopyMaterial,
    );
    cone.position.y = trunkHeight * 0.65 + level * (size.height * 0.38);
    group.add(cone);
  });

  return group;
}

function createHouseDraft(
  materialName: string | null | undefined,
  size: { width: number; height: number; depth: number },
) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size.width * 0.85, size.height * 0.62, size.depth * 0.85),
    createMaterial(materialName ?? "wood"),
  );
  body.position.y = size.height * 0.31;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(size.width * 0.62, 0.85), size.height * 0.52, 4),
    createMaterial("bark"),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = size.height * 0.83;
  group.add(roof);

  return group;
}

function createPrimitiveDraft(
  primitive: string,
  materialName: string | null | undefined,
  size: { width: number; height: number; depth: number },
) {
  const material = createMaterial(materialName);

  let geometry: THREE.BufferGeometry;
  switch (primitive) {
    case "column":
      geometry = new THREE.CylinderGeometry(
        Math.max(size.width * 0.2, 0.28),
        Math.max(size.depth * 0.22, 0.3),
        Math.max(size.height, 1),
        16,
      );
      break;
    case "blob":
      geometry = new THREE.DodecahedronGeometry(Math.max(size.width * 0.4, 0.45), 0);
      break;
    default:
      geometry = new THREE.BoxGeometry(
        Math.max(size.width, 0.8),
        Math.max(size.height, 0.8),
        Math.max(size.depth, 0.8),
      );
      break;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y =
    primitive === "blob"
      ? Math.max(size.height * 0.42, 0.5)
      : Math.max(size.height * 0.5, 0.5);

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function createMaterial(name: string | null | undefined) {
  const color = resolveMaterialColor(name);
  return new THREE.MeshStandardMaterial({
    color,
    roughness: name === "glass_block" ? 0.18 : 0.84,
    metalness: name === "neon" ? 0.08 : 0.02,
    emissive:
      name === "neon" || name === "lava_light"
        ? new THREE.Color(color).multiplyScalar(0.28)
        : new THREE.Color("#000000"),
    transparent: name === "glass_block",
    opacity: name === "glass_block" ? 0.68 : 1,
  });
}

function resolveMaterialColor(name: string | null | undefined) {
  if (name?.startsWith("#")) {
    return name;
  }

  switch (name) {
    case "red":
      return "#c63a36";
    case "wood":
      return "#8f6745";
    case "bark":
      return "#64432f";
    case "pine_green":
      return "#2f7a4a";
    case "stone":
      return "#87919b";
    case "moss_stone":
      return "#6d8860";
    case "neon":
      return "#4de8c3";
    case "glass_block":
      return "#d3f5ff";
    case "jelly":
      return "#ff7cb1";
    case "cloud":
      return "#f4f7ff";
    case "lava_light":
      return "#ff9a3d";
    case "void":
      return "#3c315a";
    default:
      return "#7aaec2";
  }
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}
