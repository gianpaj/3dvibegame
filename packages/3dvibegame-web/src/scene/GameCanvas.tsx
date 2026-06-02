import { useEffect, useRef, type ComponentRef, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SceneDocument } from "../core";
import { ReferenceWorld } from "./ReferenceWorld";
import { SceneObjects } from "./SceneObjects";

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

interface Props {
  document: SceneDocument;
  selectedObjectId: string | null;
  onSelectObject?: (objectId: string) => void;
  /** True while a movable object is selected (object moves) vs. not (camera moves). */
  hasSelectedObjectRef: RefObject<boolean>;
  /** Moves the selected object by a world-axis delta (X, Z). */
  onMoveObject: (dx: number, dz: number) => void;
}

export function GameCanvas({
  document,
  selectedObjectId,
  onSelectObject,
  hasSelectedObjectRef,
  onMoveObject,
}: Props) {
  const controlsRef = useRef<OrbitControlsRef>(null);

  return (
    <Canvas
      shadows={{ type: THREE.PCFSoftShadowMap }}
      camera={{ fov: 48, near: 0.1, far: 150, position: [5.2, 4.2, 6.4] }}
      gl={{
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#ebe4d7"]} />
      <fog attach="fog" args={["#ebe4d7", 14, 26]} />
      <hemisphereLight args={["#f6fcff", "#7ea1b0", 1.25]} />
      <directionalLight
        position={[7, 10, 8]}
        color="#fff8ef"
        intensity={2.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <directionalLight position={[-5, 6, -8]} color="#d8e6ff" intensity={0.38} />
      <ReferenceWorld />
      <SceneObjects
        document={document}
        selectedObjectId={selectedObjectId}
        onSelectObject={onSelectObject}
      />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        maxPolarAngle={Math.PI * 0.47}
        minDistance={2.8}
        maxDistance={18}
        target={[0, 2.2, 0]}
        enablePan={false}
      />
      <KeyboardController
        controlsRef={controlsRef}
        hasSelectedObjectRef={hasSelectedObjectRef}
        onMoveObject={onMoveObject}
      />
    </Canvas>
  );
}

interface KeyboardControllerProps {
  controlsRef: RefObject<OrbitControlsRef | null>;
  hasSelectedObjectRef: RefObject<boolean>;
  onMoveObject: (dx: number, dz: number) => void;
  step?: number;
}

/**
 * WASD keyboard handling. When an object is selected, WASD moves it on the world
 * X/Z plane; otherwise WASD pans the camera (and its orbit target) along the
 * camera-relative ground plane.
 */
function KeyboardController({
  controlsRef,
  hasSelectedObjectRef,
  onMoveObject,
  step = 0.5,
}: KeyboardControllerProps) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (key !== "w" && key !== "a" && key !== "s" && key !== "d") return;

      // Don't hijack typing in the prompt box or other inputs.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      event.preventDefault();

      if (hasSelectedObjectRef.current) {
        // World-axis object move: A/D = ∓X, W/S = ∓Z.
        let dx = 0;
        let dz = 0;
        if (key === "a") dx = -step;
        else if (key === "d") dx = step;
        else if (key === "w") dz = -step;
        else if (key === "s") dz = step;
        onMoveObject(dx, dz);
        return;
      }

      const controls = controlsRef.current;
      if (!controls) return;

      // Camera-relative ground pan: move both the camera and its orbit target.
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) return;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

      const move = new THREE.Vector3();
      if (key === "w") move.add(forward);
      else if (key === "s") move.addScaledVector(forward, -1);
      else if (key === "a") move.addScaledVector(right, -1);
      else if (key === "d") move.add(right);
      move.multiplyScalar(step);

      camera.position.add(move);
      controls.target.add(move);
      controls.update();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [camera, controlsRef, hasSelectedObjectRef, onMoveObject, step]);

  return null;
}
