import "./styles.css";

import { scenarioCatalog } from "./runtime/scenarios";
import { createGenerationSessionController } from "./runtime/generationSession";
import { createCameraRig } from "./render/app/createCameraRig";
import { createLoop } from "./render/app/createLoop";
import { createRenderer } from "./render/app/createRenderer";
import { createScene } from "./render/app/createScene";
import { createAuthorityBridge } from "./render/adapters/authorityBridge";
import { createHud } from "./ui/createHud";

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
const hud = createHud({
  root: hudRoot,
  scenarios: scenarioCatalog,
  onPromptSubmit: submitPrompt,
  onAction: runAction,
});
const unsubscribe = generation.subscribe(renderSnapshot);

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

renderSnapshot();

function submitPrompt(prompt: string) {
  generation.submitPrompt(prompt);
}

function runAction(actionId: Parameters<typeof generation.dispatch>[0]) {
  generation.dispatch(actionId);
}

function renderSnapshot() {
  const snapshot = generation.getSnapshot();
  const focusPoint = authorityBridge.renderWorld(snapshot.world);
  cameraRig.focus(focusPoint);
  hud.setSnapshot(snapshot);
}

window.addEventListener("beforeunload", () => {
  unsubscribe();
  generation.dispose();
});
