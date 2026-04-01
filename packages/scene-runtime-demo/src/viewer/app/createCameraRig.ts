import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as THREE from "three";

export function createCameraRig(renderer: THREE.WebGLRenderer) {
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 150);
  camera.position.set(10, 8, 10);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 4;
  controls.maxDistance = 30;

  return {
    camera,
    controls,
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    focus(target: THREE.Vector3) {
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      controls.update();
    },
  };
}
