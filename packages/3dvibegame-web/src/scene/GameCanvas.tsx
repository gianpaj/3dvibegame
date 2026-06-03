import { useEffect, useRef, type ComponentRef, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Cloud, Clouds } from "@react-three/drei";
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
  /** Moves the selected object by a world-axis delta (X, Y, Z). */
  onMoveObject: (dx: number, dy: number, dz: number) => void;
  /** Clears the current selection (clicking empty space). */
  onDeselect: () => void;
}

// Clicks that move more than this are treated as a camera drag, not a deselect.
const dragThreshold = 6;

export function GameCanvas({
  document,
  selectedObjectId,
  onSelectObject,
  hasSelectedObjectRef,
  onMoveObject,
  onDeselect,
}: Props) {
  const controlsRef = useRef<OrbitControlsRef>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <Canvas
      shadows={{ type: THREE.PCFSoftShadowMap }}
      camera={{ fov: 48, near: 0.1, far: 500, position: [5.2, 4.2, 6.4] }}
      gl={{
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ width: "100%", height: "100%" }}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMissed={(event) => {
        // Fired when a click hits no object (empty space / floor). Ignore camera
        // drags and only deselect when something is actually selected.
        const down = pointerDownRef.current;
        pointerDownRef.current = null;
        if (!down || !hasSelectedObjectRef.current) return;
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (moved <= dragThreshold) onDeselect();
      }}
    >
      <color attach="background" args={["#b8daf5"]} />
      <fog attach="fog" args={["#b8daf5", 60, 180]} />
      <hemisphereLight args={["#87ceeb", "#4a8a30", 1.1]} />
      <directionalLight
        position={[10, 15, 5]}
        color="#fffaf0"
        intensity={2.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <directionalLight position={[-5, 6, -8]} color="#d8e6ff" intensity={0.3} />
      <Clouds material={THREE.MeshLambertMaterial}>
        <Cloud
          seed={1}
          segments={20}
          bounds={[14, 2.5, 3]}
          volume={10}
          color="white"
          opacity={0.9}
          position={[8, 22, -38]}
        />
        <Cloud
          seed={4}
          segments={15}
          bounds={[10, 2, 2.5]}
          volume={7}
          color="white"
          opacity={0.85}
          position={[-16, 26, -45]}
        />
      </Clouds>
      <ReferenceWorld />
      <SceneObjects
        document={document}
        selectedObjectId={selectedObjectId}
        onSelectObject={onSelectObject}
      />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        minDistance={2.8}
        maxDistance={18}
        target={[0, 1.5, 0]}
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
  onMoveObject: (dx: number, dy: number, dz: number) => void;
  step?: number;
}

/**
 * WASD/QE keyboard handling. When an object is selected, WASD moves it on the
 * world X/Z plane and Q/E moves it up/down; otherwise WASD pans the camera.
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
      const isMovKey = key === "w" || key === "a" || key === "s" || key === "d";
      const isVertKey = key === "q" || key === "e";
      if (!isMovKey && !isVertKey) return;

      // Don't hijack typing in the prompt box or other inputs.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      event.preventDefault();

      // Q/E: vertical movement — only when an object is selected.
      if (isVertKey) {
        if (!hasSelectedObjectRef.current) return;
        const dy = key === "q" ? step : -step;
        onMoveObject(0, dy, 0);
        return;
      }

      // Camera-relative ground direction, shared by object-move and camera-pan so
      // both feel consistent: W = away from camera, S = toward, A = left, D = right.
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

      if (hasSelectedObjectRef.current) {
        // Move the selected object along the camera-relative ground plane.
        onMoveObject(move.x, 0, move.z);
        return;
      }

      const controls = controlsRef.current;
      if (!controls) return;
      camera.position.add(move);
      controls.target.add(move);
      controls.update();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [camera, controlsRef, hasSelectedObjectRef, onMoveObject, step]);

  return null;
}
