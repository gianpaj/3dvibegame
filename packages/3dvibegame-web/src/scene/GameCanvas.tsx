import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SceneDocument } from "../core";
import { ReferenceWorld } from "./ReferenceWorld";
import { SceneObjects } from "./SceneObjects";

interface Props {
  document: SceneDocument;
  selectedObjectId: string | null;
  onSelectObject?: (objectId: string) => void;
}

export function GameCanvas({ document, selectedObjectId, onSelectObject }: Props) {
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
        enableDamping
        maxPolarAngle={Math.PI * 0.47}
        minDistance={2.8}
        maxDistance={18}
        target={[0, 2.2, 0]}
        enablePan={false}
      />
    </Canvas>
  );
}
