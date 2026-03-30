import type { AuthorityObject, BuilderPart } from "@3dvibegame/scene-authority-ts";
import * as THREE from "three";

interface AuthorityObjectConfig {
  object: AuthorityObject;
  resolveAnchor(referenceId?: string | null): THREE.Vector3 | null;
}

export function createAuthorityObject({
  object,
  resolveAnchor,
}: AuthorityObjectConfig) {
  const group = new THREE.Group();
  group.name = object.object_id;
  const focusAccumulator = new THREE.Vector3();

  object.builder_spec.instances.forEach((instance) => {
    const instanceGroup = new THREE.Group();
    instanceGroup.position.copy(
      resolveInstancePosition({
        object,
        instance,
        resolveAnchor,
      }),
    );
    instanceGroup.rotation.set(...object.transform.rotation);
    instanceGroup.scale.set(...object.transform.scale);

    object.builder_spec.parts.forEach((part, partIndex) => {
      const partMesh = createPartMesh(part, partIndex);
      partMesh.position.copy(resolvePartPosition(object.builder_spec.parts, part, partIndex));
      instanceGroup.add(partMesh);
    });

    group.add(instanceGroup);
    focusAccumulator.add(instanceGroup.position);
  });

  if (object.state === "grace" || object.state === "edit_locked") {
    group.add(createStateRing(object.state));
  }

  const focusPoint =
    object.builder_spec.instances.length > 0
      ? focusAccumulator.multiplyScalar(1 / object.builder_spec.instances.length)
      : new THREE.Vector3();

  return { group, focusPoint };
}

function resolveInstancePosition({
  object,
  instance,
  resolveAnchor,
}: {
  object: AuthorityObject;
  instance: AuthorityObject["builder_spec"]["instances"][number];
  resolveAnchor(referenceId?: string | null): THREE.Vector3 | null;
}) {
  const placement = object.builder_spec.placement;
  const reference =
    resolveAnchor(instance.reference_object ?? placement.reference_object) ??
    new THREE.Vector3();

  return reference
    .clone()
    .add(new THREE.Vector3(...instance.offset))
    .add(new THREE.Vector3(...object.transform.position));
}

function resolvePartPosition(
  parts: BuilderPart[],
  part: BuilderPart,
  partIndex: number,
) {
  const yBase = part.dimensions[1] / 2;

  if (part.part_id === "canopy") {
    const trunk = parts.find((candidate) => candidate.part_id === "main");
    return new THREE.Vector3(0, (trunk?.dimensions[1] ?? 0) + yBase * 0.8, 0);
  }

  return new THREE.Vector3(0, yBase + partIndex * 0.02, 0);
}

function createPartMesh(part: BuilderPart, partIndex: number) {
  const geometry = createGeometry(part);
  const material = createMaterial(part.material, part.modifiers);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.partIndex = partIndex;
  return mesh;
}

function createGeometry(part: BuilderPart) {
  const [width, height, depth] = part.dimensions;

  switch (part.primitive) {
    case "column":
      return new THREE.CylinderGeometry(width * 0.45, depth * 0.5, height, 18);
    case "blob":
      return new THREE.DodecahedronGeometry(Math.max(width, height, depth) * 0.48, 0);
    default:
      return new THREE.BoxGeometry(width, height, depth);
  }
}

function createMaterial(name: string, modifiers: string[]) {
  const color = resolveMaterialColor(name);
  const glowing = modifiers.includes("soft_glow") || name === "neon";

  return new THREE.MeshStandardMaterial({
    color,
    roughness: name === "glass_block" ? 0.2 : 0.84,
    metalness: glowing ? 0.08 : 0.03,
    emissive: glowing ? new THREE.Color(color).multiplyScalar(0.35) : new THREE.Color("#000000"),
    emissiveIntensity: glowing ? 0.5 : 0,
  });
}

function createStateRing(state: AuthorityObject["state"]) {
  const color = state === "grace" ? "#ffd36a" : "#ff945f";
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.85, 0.06, 12, 48),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.55,
      metalness: 0.08,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  return ring;
}

function resolveMaterialColor(name: string) {
  switch (name) {
    case "red":
      return "#c63a36";
    case "wood":
      return "#8f6745";
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
      return "#40355e";
    default:
      return "#7aaec2";
  }
}
