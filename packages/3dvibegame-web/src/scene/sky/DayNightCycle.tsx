import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import {
  parseTimeOfDayOverride,
  skyStateAtHours,
  skyStateAtUtc,
  smoothstep,
  type SkyState,
} from "./sunPosition";

// One canonical sun/moon direction pair (from sunPosition) that the lights,
// discs and palette all read — the claudecraft "SUN_ANCHOR" principle, except
// ours moves with real UTC time.

const LIGHT_DISTANCE = 24; // light offset along the celestial direction
const DISC_DISTANCE = 380; // visual discs ride the camera near the far plane
const SHADOW_EXTENT = 15; // tight ortho box around the player keeps maps crisp
const COLOR_RATE = 1.5; // 1/s exponential ease for palette transitions
const STAR_COUNT = 700;
const STAR_RADIUS = 320;

// Day / twilight / night palettes, blended by sun elevation each frame. The
// background <color> and <fog> live in GameCanvas; we mutate their colors.
const PALETTE = {
  background: {
    day: new THREE.Color("#b8daf5"),
    dusk: new THREE.Color("#e8a06b"),
    night: new THREE.Color("#0b1026"),
  },
  hemiSky: {
    day: new THREE.Color("#87ceeb"),
    dusk: new THREE.Color("#c98a6a"),
    night: new THREE.Color("#16203d"),
  },
  hemiGround: {
    day: new THREE.Color("#4a8a30"),
    dusk: new THREE.Color("#4a3a2a"),
    night: new THREE.Color("#0e1611"),
  },
  sun: {
    day: new THREE.Color("#fffaf0"),
    dusk: new THREE.Color("#ff9e5e"),
    night: new THREE.Color("#ff9e5e"),
  },
} as const;

const MOON_COLOR = "#9db4ff";

function blend(
  out: THREE.Color,
  colors: { day: THREE.Color; dusk: THREE.Color; night: THREE.Color },
  day: number,
  dusk: number,
  night: number,
): THREE.Color {
  out.setRGB(
    colors.day.r * day + colors.dusk.r * dusk + colors.night.r * night,
    colors.day.g * day + colors.dusk.g * dusk + colors.night.g * night,
    colors.day.b * day + colors.dusk.b * dusk + colors.night.b * night,
  );
  return out;
}

/** Soft radial-gradient texture for the sun/moon discs. */
function discTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function starsGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform-ish points on the upper hemisphere, kept off the horizon line.
    const azimuth = Math.random() * Math.PI * 2;
    const y = 0.12 + Math.random() * 0.88;
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(azimuth) * r * STAR_RADIUS;
    positions[i * 3 + 1] = y * STAR_RADIUS;
    positions[i * 3 + 2] = Math.sin(azimuth) * r * STAR_RADIUS;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

interface DayNightCycleProps {
  /** Live world position the shadow frustum re-anchors on (the local avatar). */
  followRef?: RefObject<THREE.Vector3>;
}

/**
 * UTC-driven sun + moon. The sun sweeps a stylized east-to-west orbit matching
 * the real UTC clock (sunrise 06:00, sunset 18:00); after sunset a dim blue
 * moon takes over as the single shadow caster. Background, fog, hemisphere
 * light and a starfield follow the same elevation-blended palette. Pin the
 * clock with `?timeOfDay=18.5` for testing.
 */
export function DayNightCycle({ followRef }: DayNightCycleProps) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunDiscRef = useRef<THREE.Sprite>(null);
  const moonDiscRef = useRef<THREE.Sprite>(null);
  const starsMatRef = useRef<THREE.PointsMaterial>(null);
  const starsRef = useRef<THREE.Points>(null);

  const timeOverride = useMemo(
    () => parseTimeOfDayOverride(window.location.search),
    [],
  );

  const sunDiscMap = useMemo(
    () =>
      discTexture([
        [0, "rgba(255, 245, 225, 1)"],
        [0.25, "rgba(255, 220, 160, 0.9)"],
        [1, "rgba(255, 200, 120, 0)"],
      ]),
    [],
  );
  const moonDiscMap = useMemo(
    () =>
      discTexture([
        [0, "rgba(235, 240, 255, 1)"],
        [0.45, "rgba(210, 220, 250, 0.85)"],
        [0.55, "rgba(180, 195, 240, 0.25)"],
        [1, "rgba(160, 180, 230, 0)"],
      ]),
    [],
  );
  const starsGeo = useMemo(() => starsGeometry(), []);

  useEffect(() => {
    return () => {
      sunDiscMap.dispose();
      moonDiscMap.dispose();
      starsGeo.dispose();
    };
  }, [sunDiscMap, moonDiscMap, starsGeo]);

  // Directional-light targets only update while they're in the scene graph.
  useEffect(() => {
    const targets = [sunRef.current?.target, moonRef.current?.target].filter(
      (t): t is THREE.Object3D => !!t,
    );
    for (const target of targets) scene.add(target);
    return () => {
      for (const target of targets) scene.remove(target);
    };
  }, [scene]);

  // Celestial angles move imperceptibly per frame; recompute ~once per second.
  const skyRef = useRef<SkyState>(
    timeOverride !== null
      ? skyStateAtHours(timeOverride)
      : skyStateAtUtc(new Date()),
  );
  const nextComputeRef = useRef(0);
  const scratchColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.25);
    if (state.clock.elapsedTime >= nextComputeRef.current) {
      nextComputeRef.current = state.clock.elapsedTime + 1;
      skyRef.current =
        timeOverride !== null
          ? skyStateAtHours(timeOverride)
          : skyStateAtUtc(new Date());
    }
    const sky = skyRef.current;

    // Phase weights from sun elevation: day above ~+0.25, night below ~-0.25,
    // twilight ramping in between. Weights always sum to 1.
    const day = smoothstep(0.03, 0.25, sky.sunElevation);
    const night = smoothstep(0.03, 0.25, -sky.sunElevation);
    const dusk = 1 - day - night;
    const ease = 1 - Math.exp(-dt * COLOR_RATE);

    const sun = sunRef.current;
    const moon = moonRef.current;
    const anchor = followRef?.current;

    if (sun) {
      if (anchor) {
        sun.position
          .set(sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z)
          .multiplyScalar(LIGHT_DISTANCE)
          .add(anchor);
        sun.target.position.copy(anchor);
      }
      sun.intensity +=
        (2.5 * day + 1.1 * dusk - sun.intensity) * ease;
      sun.color.lerp(blend(scratchColor, PALETTE.sun, day, dusk, night), ease);
      // Exactly one shadow caster at a time: the sun by day, the moon by night.
      sun.castShadow = sky.sunElevation > 0;
    }
    if (moon) {
      if (anchor) {
        moon.position
          .set(sky.moonDirection.x, sky.moonDirection.y, sky.moonDirection.z)
          .multiplyScalar(LIGHT_DISTANCE)
          .add(anchor);
        moon.target.position.copy(anchor);
      }
      moon.intensity += (0.5 * night + 0.15 * dusk - moon.intensity) * ease;
      moon.castShadow = sky.sunElevation <= 0;
    }
    const fill = fillRef.current;
    if (fill) {
      fill.intensity += (0.3 * day + 0.15 * dusk + 0.06 * night - fill.intensity) * ease;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.intensity += (1.1 * day + 0.65 * dusk + 0.3 * night - hemi.intensity) * ease;
      hemi.color.lerp(blend(scratchColor, PALETTE.hemiSky, day, dusk, night), ease);
      hemi.groundColor.lerp(
        blend(scratchColor, PALETTE.hemiGround, day, dusk, night),
        ease,
      );
    }

    // Background and fog share one palette so the horizon stays seamless.
    blend(scratchColor, PALETTE.background, day, dusk, night);
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(scratchColor, ease);
    }
    if (scene.fog) scene.fog.color.lerp(scratchColor, ease);

    // Discs and stars ride the camera, like claudecraft's sun sprites.
    const sunDisc = sunDiscRef.current;
    if (sunDisc) {
      sunDisc.position
        .set(sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z)
        .multiplyScalar(DISC_DISTANCE)
        .add(camera.position);
      sunDisc.visible = sky.sunElevation > -0.12;
    }
    const moonDisc = moonDiscRef.current;
    if (moonDisc) {
      moonDisc.position
        .set(sky.moonDirection.x, sky.moonDirection.y, sky.moonDirection.z)
        .multiplyScalar(DISC_DISTANCE)
        .add(camera.position);
      moonDisc.visible = sky.moonElevation > -0.12;
    }
    const stars = starsRef.current;
    if (stars) stars.position.copy(camera.position);
    const starsMat = starsMatRef.current;
    if (starsMat) {
      starsMat.opacity += (night - starsMat.opacity) * ease;
      if (stars) stars.visible = starsMat.opacity > 0.02;
    }
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} args={["#87ceeb", "#4a8a30", 1.1]} />
      <directionalLight
        ref={sunRef}
        position={[10, 15, 5]}
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
      <directionalLight
        ref={moonRef}
        position={[-10, 15, 5]}
        color={MOON_COLOR}
        intensity={0}
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
      {/* Cool fill so the shadow side never goes black (was static in GameCanvas). */}
      <directionalLight
        ref={fillRef}
        position={[-5, 6, -8]}
        color="#d8e6ff"
        intensity={0.3}
      />
      <sprite ref={sunDiscRef} scale={[34, 34, 1]} renderOrder={-9}>
        <spriteMaterial
          map={sunDiscMap}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          transparent
        />
      </sprite>
      <sprite ref={moonDiscRef} scale={[16, 16, 1]} renderOrder={-9}>
        <spriteMaterial
          map={moonDiscMap}
          depthWrite={false}
          fog={false}
          transparent
        />
      </sprite>
      <points ref={starsRef} geometry={starsGeo} renderOrder={-10}>
        <pointsMaterial
          ref={starsMatRef}
          color="#dfe6ff"
          size={1.6}
          sizeAttenuation={false}
          transparent
          opacity={0}
          depthWrite={false}
          fog={false}
        />
      </points>
    </>
  );
}
