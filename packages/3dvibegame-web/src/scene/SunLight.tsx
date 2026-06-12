import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Sun offset from whatever the light follows. One canonical sun direction —
 * shadows and any future sky visuals should all read this vector.
 */
export const SUN_OFFSET = new THREE.Vector3(10, 15, 5);

// Half-extent of the ortho shadow box. Tight box around the player keeps the
// 2048 map crisp; the frustum follows the avatar so coverage never runs out.
const SHADOW_EXTENT = 15;

interface SunLightProps {
  /** Live world position the shadow frustum re-anchors on (the local avatar). */
  followRef?: RefObject<THREE.Vector3>;
}

/**
 * The main shadow-casting sun. Every frame the light and its target ride along
 * with the followed position, so the shadow frustum is always centered on the
 * player and avatar shadows stay sharp anywhere in the world.
 */
export function SunLight({ followRef }: SunLightProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((state) => state.scene);

  // The light's target must live in the scene graph for its matrix to update.
  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);

  useFrame(() => {
    const light = lightRef.current;
    const follow = followRef?.current;
    if (!light || !follow) return;
    light.position.set(
      follow.x + SUN_OFFSET.x,
      follow.y + SUN_OFFSET.y,
      follow.z + SUN_OFFSET.z,
    );
    light.target.position.set(follow.x, follow.y, follow.z);
  });

  return (
    <directionalLight
      ref={lightRef}
      position={[SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z]}
      color="#fffaf0"
      intensity={2.5}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-near={0.5}
      shadow-camera-far={60}
      shadow-camera-left={-SHADOW_EXTENT}
      shadow-camera-right={SHADOW_EXTENT}
      shadow-camera-top={SHADOW_EXTENT}
      shadow-camera-bottom={-SHADOW_EXTENT}
      shadow-bias={-0.0006}
      shadow-normalBias={0.05}
    />
  );
}
