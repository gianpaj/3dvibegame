import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as THREE from "three";

export function createCameraRig(renderer: THREE.WebGLRenderer) {
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 150);
  camera.position.set(5.2, 4.2, 6.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 2.8;
  controls.maxDistance = 18;
  controls.target.set(0, 2.2, 0);

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
