import * as THREE from "three";

export function createReferenceWorld() {
  const group = new THREE.Group();
  const anchors = new Map<string, THREE.Vector3>();

  const loader = new THREE.TextureLoader();
  const repeat = 80;

  const [colorMap, normalMap, roughnessMap] = [
    loader.load("/textures/grass/diff_2k.jpg"),
    loader.load("/textures/grass/nor_gl_2k.jpg"),
    loader.load("/textures/grass/rough_2k.jpg"),
  ].map((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });

  // Diffuse map should be in sRGB
  colorMap.colorSpace = THREE.SRGBColorSpace;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshStandardMaterial({
      map: colorMap,
      normalMap,
      roughnessMap,
      roughness: 1,
      metalness: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  return {
    group,
    anchors,
    defaultFocus: new THREE.Vector3(0, 0.5, 0),
  };
}
