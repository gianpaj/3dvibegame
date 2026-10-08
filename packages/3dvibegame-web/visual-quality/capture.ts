import type { AuthorityObject } from "@3dvibegame/scene-authority-ts";
import * as THREE from "three";

import { createAuthorityObject } from "../src/viewer/objects/createAuthorityObject";
import type {
  CapturePageApi,
  PageCaptureRequest,
  PageCaptureResult,
  PageCapturedView,
  Vec3,
} from "./contract";
import { boundsCenter, fitCamera, VIEWS, viewDirection } from "./framing";
import { computeViewStats } from "./pixelStats";

// Development-only capture page for offline visual-quality evaluation. Renders
// one stored builder spec through the game's own mesh factory under fixed,
// neutral conditions: public state, no rings, no day/night cycle, no HUD.
// Bump CAPTURE_VERSION when lighting, framing or output handling changes.

const CAPTURE_VERSION = "capture-v1";

declare global {
  interface Window {
    __vq?: CapturePageApi;
  }
}

const api: CapturePageApi = { ready: false, init_error: null, info: null, capture };
window.__vq = api;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  // Match the game's colour pipeline (GameCanvas.tsx).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  api.info = {
    capture_version: CAPTURE_VERSION,
    three_revision: THREE.REVISION,
    tone_mapping: "ACESFilmicToneMapping",
    output_color_space: renderer.outputColorSpace,
    gl_renderer: glRendererName(renderer.getContext()),
  };
  api.ready = true;
} catch (error) {
  api.init_error = `WebGL initialisation failed: ${(error as Error).message}`;
}

async function capture(request: PageCaptureRequest): Promise<PageCaptureResult> {
  const scene = new THREE.Scene();
  try {
    const { settings } = request;
    renderer.setPixelRatio(settings.device_pixel_ratio);
    renderer.setSize(settings.width, settings.height, false);
    renderer.toneMappingExposure = settings.tone_mapping_exposure;
    scene.background = new THREE.Color(settings.background);

    const object: AuthorityObject = {
      object_id: "visual_quality_capture",
      world_id: "visual_quality",
      state: "public",
      version: 1,
      created_by: "visual_quality",
      latest_editor: "visual_quality",
      builder_spec: request.builder_spec as AuthorityObject["builder_spec"],
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      cooldown_remaining_seconds: 0,
      grace_remaining_seconds: 0,
    };
    // Relative placements resolve against the origin, as in the live scene.
    const { group } = createAuthorityObject({ object, selected: false, resolveAnchor: () => null });
    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return { ok: false, error: "rendered object has empty bounds" };
    const bounds = { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) <= 0) return { ok: false, error: "rendered object has zero size" };

    addLights(scene, box);
    const points = worldVertices(group);
    const target = boundsCenter(bounds);

    const views: PageCapturedView[] = [];
    for (const view of VIEWS) {
      const pose = fitCamera(
        points,
        target,
        viewDirection(view),
        settings.fov_degrees,
        settings.width / settings.height,
        settings.framing_padding,
      );
      const camera = new THREE.PerspectiveCamera(pose.fov_degrees, settings.width / settings.height, pose.near, pose.far);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.lookAt(...pose.target);
      camera.updateProjectionMatrix();

      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      const { png, stats } = readCanvas(renderer.domElement, settings.width, settings.height);
      views.push({ view_id: view.view_id, label: view.label, png_base64: png, camera: pose, stats });
    }

    return { ok: true, bounds: { ...bounds, size: size.toArray() as Vec3 }, views };
  } catch (error) {
    return { ok: false, error: (error as Error).stack ?? String(error) };
  } finally {
    disposeScene(scene);
  }
}

// Neutral studio lighting fixed in world space, so all three views see the
// same lit object. One shadow-casting key light, fitted to the object.
function addLights(scene: THREE.Scene, box: THREE.Box3) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.5);

  scene.add(new THREE.HemisphereLight("#f4f6ff", "#7d828c", 1.6));

  const key = new THREE.DirectionalLight("#ffffff", 2.2);
  key.position.copy(center).add(new THREE.Vector3(0.55, 1, 0.75).normalize().multiplyScalar(radius * 4));
  key.target.position.copy(center);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -radius * 1.2;
  shadowCamera.right = radius * 1.2;
  shadowCamera.top = radius * 1.2;
  shadowCamera.bottom = -radius * 1.2;
  shadowCamera.near = radius * 0.5;
  shadowCamera.far = radius * 8;
  shadowCamera.updateProjectionMatrix();
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight("#dfe6ff", 0.7);
  fill.position.copy(center).add(new THREE.Vector3(-0.8, 0.35, -0.6).normalize().multiplyScalar(radius * 4));
  fill.target.position.copy(center);
  scene.add(fill, fill.target);
}

function worldVertices(group: THREE.Object3D): Vec3[] {
  group.updateMatrixWorld(true);
  const points: Vec3[] = [];
  const vertex = new THREE.Vector3();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      points.push(vertex.toArray() as Vec3);
    }
  });
  return points;
}

function readCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dataUrl = canvas.toDataURL("image/png");
  // Stats are computed at the nominal size so they don't depend on DPR.
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  return {
    png: dataUrl.slice(dataUrl.indexOf(",") + 1),
    stats: computeViewStats(pixels, width, height),
  };
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material: THREE.Material) => material.dispose());
    }
    if (child instanceof THREE.DirectionalLight) child.shadow.dispose();
  });
  scene.clear();
  renderer?.renderLists.dispose();
}

function glRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
}
