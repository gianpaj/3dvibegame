import * as THREE from "three";

export function createReferenceWorld() {
  const group = new THREE.Group();
  const anchors = new Map<string, THREE.Vector3>();

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(10, 72),
    new THREE.MeshStandardMaterial({
      color: "#efe5d8",
      roughness: 0.96,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.8, 0.55, 48),
    new THREE.MeshStandardMaterial({
      color: "#d8cfbf",
      roughness: 0.86,
      metalness: 0.04,
    }),
  );
  pedestal.position.y = 0.275;
  pedestal.receiveShadow = true;
  pedestal.castShadow = true;
  group.add(pedestal);

  const inset = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.35, 0.08, 48),
    new THREE.MeshStandardMaterial({
      color: "#c8d3cb",
      roughness: 0.82,
      metalness: 0.03,
    }),
  );
  inset.position.y = 0.58;
  inset.receiveShadow = true;
  group.add(inset);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 10),
    new THREE.MeshStandardMaterial({
      color: "#d9d3c8",
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  backdrop.position.set(0, 5, -5.4);
  backdrop.receiveShadow = true;
  group.add(backdrop);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.08, 12, 64),
    new THREE.MeshStandardMaterial({
      color: "#cabda9",
      emissive: "#cabda9",
      emissiveIntensity: 0.08,
      roughness: 0.7,
      metalness: 0.04,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.62;
  group.add(halo);

  const sideColumnLeft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 8.4, 24),
    new THREE.MeshStandardMaterial({
      color: "#cec3b1",
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  sideColumnLeft.position.set(-5.1, 4.1, -3.8);
  sideColumnLeft.castShadow = true;
  group.add(sideColumnLeft);

  const sideColumnRight = sideColumnLeft.clone();
  sideColumnRight.position.x = 5.1;
  group.add(sideColumnRight);

  return {
    group,
    anchors,
    defaultFocus: new THREE.Vector3(0, 2.4, 0),
  };
}
