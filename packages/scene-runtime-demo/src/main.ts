import "./styles.css";

import { createGenerationSessionController, scenarioCatalog } from "./core";
import { createEditorCommands, createHud } from "./editor";
import {
  createAuthorityBridge,
  createCameraRig,
  createLoop,
  createRenderer,
  createScene,
} from "./viewer";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Expected #root container for scene runtime demo");
}

root.innerHTML = `
  <div class="app-shell">
    <div class="viewport" data-role="viewport"></div>
    <aside class="hud" data-role="hud"></aside>
  </div>
`;

const viewport = root.querySelector<HTMLElement>('[data-role="viewport"]');
const hudRoot = root.querySelector<HTMLElement>('[data-role="hud"]');

if (!viewport || !hudRoot) {
  throw new Error("Failed to bootstrap viewport shell");
}

const renderer = createRenderer(viewport);
const sceneState = createScene();
const cameraRig = createCameraRig(renderer.renderer);
cameraRig.focus(sceneState.defaultFocus);

const authorityBridge = createAuthorityBridge({
  draftRoot: sceneState.draftRoot,
  anchors: sceneState.anchors,
  defaultFocus: sceneState.defaultFocus,
});

const loop = createLoop({
  renderer: renderer.renderer,
  scene: sceneState.scene,
  camera: cameraRig.camera,
});
loop.add(() => {
  cameraRig.controls.update();
});
loop.start();

const generation = createGenerationSessionController();
const editorCommands = createEditorCommands(generation);
const hud = createHud({
  root: hudRoot,
  scenarios: scenarioCatalog,
  onPromptSubmit(prompt) {
    editorCommands.submitPrompt(prompt);
  },
  onAction(actionId) {
    editorCommands.dispatchAction(actionId);
  },
  onObjectSelect(objectId) {
    editorCommands.selectObject(objectId);
  },
});
const unsubscribe = generation.subscribe(renderSnapshot);
let pointerDown: { x: number; y: number } | null = null;

const resize = () => {
  const { clientWidth, clientHeight } = viewport;
  renderer.resize(clientWidth, clientHeight);
  cameraRig.resize(clientWidth / Math.max(clientHeight, 1));
};

window.addEventListener("resize", resize);
resize();

renderer.canvas.addEventListener("webglcontextlost", (event: Event) => {
  event.preventDefault();
  hud.setContextMessage("WebGL context lost. Waiting for browser recovery.");
});

renderer.canvas.addEventListener("webglcontextrestored", () => {
  hud.setContextMessage("");
  resize();
});

renderer.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY };
});

renderer.canvas.addEventListener("pointerup", (event: PointerEvent) => {
  if (event.button !== 0 || !pointerDown) return;

  const distance = Math.hypot(
    event.clientX - pointerDown.x,
    event.clientY - pointerDown.y,
  );
  pointerDown = null;

  if (distance > 6) {
    return;
  }

  const objectId = authorityBridge.pickObject(
    event.clientX,
    event.clientY,
    cameraRig.camera,
    renderer.canvas,
  );

  if (objectId) {
    editorCommands.selectObject(objectId);
    return;
  }

  editorCommands.deselectObject();
});

renderSnapshot();

function renderSnapshot() {
  const snapshot = generation.getSnapshot();
  const focusPoint = authorityBridge.renderDocument(snapshot.document);
  cameraRig.focus(focusPoint);
  hud.setSnapshot(snapshot);
}

window.addEventListener("beforeunload", () => {
  unsubscribe();
  generation.dispose();
  authorityBridge.dispose();
});
