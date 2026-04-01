import * as THREE from "three";

export function createReferenceWorld() {
  const group = new THREE.Group();
  const anchors = new Map<string, THREE.Vector3>();

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(18, 64),
    new THREE.MeshStandardMaterial({
      color: "#dfead5",
      roughness: 0.98,
      metalness: 0.02,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const grid = new THREE.GridHelper(28, 28, "#7593a0", "#9bb5bf");
  grid.position.y = 0.01;
  group.add(grid);

  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 40),
    new THREE.MeshStandardMaterial({
      color: "#7ab8d8",
      roughness: 0.35,
      metalness: 0.05,
    }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(0, 0.02, -5.5);
  lake.receiveShadow = true;
  group.add(lake);
  anchors.set("lake_1", lake.position.clone());

  const cabin = createCabinLandmark();
  cabin.position.set(-3, 0, 0.5);
  group.add(cabin);
  anchors.set("cabin_1", cabin.position.clone());

  const campfire = createCampfireLandmark();
  campfire.position.set(3.2, 0, 1.4);
  group.add(campfire);
  anchors.set("campfire_1", campfire.position.clone());

  const path = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.02, 1.1),
    new THREE.MeshStandardMaterial({
      color: "#c4ae8e",
      roughness: 1,
      metalness: 0,
    }),
  );
  path.position.set(0.5, 0.02, 2.4);
  path.receiveShadow = true;
  group.add(path);

  return {
    group,
    anchors,
    defaultFocus: new THREE.Vector3(0.5, 1.1, 0.5),
  };
}

function createCabinLandmark() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.8, 2.4),
    new THREE.MeshStandardMaterial({
      color: "#8b6848",
      roughness: 0.94,
      metalness: 0.02,
    }),
  );
  body.position.y = 0.9;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 1.2, 4),
    new THREE.MeshStandardMaterial({
      color: "#5a4333",
      roughness: 0.95,
      metalness: 0.01,
    }),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.15;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  const marker = createAnchorMarker("#f4dcc0");
  marker.position.set(0, 2.95, 0);
  group.add(marker);

  return group;
}

function createCampfireLandmark() {
  const group = new THREE.Group();

  const stones = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.15, 0.28, 8),
    new THREE.MeshStandardMaterial({
      color: "#6f7784",
      roughness: 0.97,
      metalness: 0.02,
    }),
  );
  stones.position.y = 0.14;
  stones.castShadow = true;
  stones.receiveShadow = true;
  group.add(stones);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.1, 6),
    new THREE.MeshStandardMaterial({
      color: "#ff8a39",
      emissive: "#ff6d2d",
      emissiveIntensity: 0.45,
      roughness: 0.55,
      metalness: 0,
    }),
  );
  flame.position.y = 0.75;
  flame.castShadow = true;
  group.add(flame);

  const marker = createAnchorMarker("#ffd595");
  marker.position.set(0, 1.55, 0);
  group.add(marker);

  return group;
}

function createAnchorMarker(color: string) {
  const marker = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.7, 12),
    new THREE.MeshStandardMaterial({
      color: "#375260",
      roughness: 0.85,
      metalness: 0.05,
    }),
  );
  stem.position.y = 0.35;
  marker.add(stem);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.4,
      metalness: 0.02,
    }),
  );
  head.position.y = 0.72;
  head.castShadow = true;
  marker.add(head);

  return marker;
}
