import * as THREE from "three";

import { createReferenceWorld } from "../objects/createReferenceWorld";

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#ebe4d7");
  scene.fog = new THREE.Fog("#ebe4d7", 14, 26);

  const hemisphereLight = new THREE.HemisphereLight("#f6fcff", "#7ea1b0", 1.25);
  scene.add(hemisphereLight);

  const sun = new THREE.DirectionalLight("#fff8ef", 2.25);
  sun.position.set(7, 10, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  scene.add(sun);

  const fillLight = new THREE.DirectionalLight("#d8e6ff", 0.38);
  fillLight.position.set(-5, 6, -8);
  scene.add(fillLight);

  const referenceWorld = createReferenceWorld();
  const draftRoot = new THREE.Group();
  draftRoot.name = "runtime-drafts";
  const presenceRoot = new THREE.Group();
  presenceRoot.name = "remote-player-presence";

  scene.add(referenceWorld.group);
  scene.add(draftRoot);
  scene.add(presenceRoot);

  return {
    scene,
    draftRoot,
    presenceRoot,
    anchors: referenceWorld.anchors,
    defaultFocus: referenceWorld.defaultFocus,
  };
}
