import type * as THREE from "three";

// Minimal structural type for the OrbitControls instance the avatar layer drives:
// it needs the orbit target (a Vector3) and update(). Declared here to avoid a
// direct three-stdlib type dependency.
export interface OrbitControlsLike {
  target: THREE.Vector3;
  update(): void;
}
