import * as THREE from "three";

import { createReferenceWorld } from "../objects/createReferenceWorld";

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe9f0");
  scene.fog = new THREE.Fog("#cfe9f0", 18, 38);

  const hemisphereLight = new THREE.HemisphereLight("#f6fcff", "#7ea1b0", 1.25);
  scene.add(hemisphereLight);

  const sun = new THREE.DirectionalLight("#fffaf0", 2.1);
  sun.position.set(10, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  scene.add(sun);

  const fillLight = new THREE.DirectionalLight("#9cd3ff", 0.45);
  fillLight.position.set(-6, 5, -10);
  scene.add(fillLight);

  const referenceWorld = createReferenceWorld();
  const draftRoot = new THREE.Group();
  draftRoot.name = "runtime-drafts";

  scene.add(referenceWorld.group);
  scene.add(draftRoot);

  return {
    scene,
    draftRoot,
    anchors: referenceWorld.anchors,
    defaultFocus: referenceWorld.defaultFocus,
  };
}
