import * as THREE from "three";

interface LoopConfig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

type UpdateCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

export function createLoop({ renderer, scene, camera }: LoopConfig) {
  const clock = new THREE.Clock();
  const callbacks = new Set<UpdateCallback>();

  return {
    add(callback: UpdateCallback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    start() {
      renderer.setAnimationLoop(() => {
        const deltaSeconds = clock.getDelta();
        const elapsedSeconds = clock.elapsedTime;

        for (const callback of callbacks) {
          callback(deltaSeconds, elapsedSeconds);
        }

        renderer.render(scene, camera);
      });
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
  };
}
