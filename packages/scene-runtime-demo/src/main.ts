import "./styles.css";

import type {
  BackendLifecycleCommands,
  BackendPlayerTransform,
  BackendPresenceSnapshot,
} from "./backend";
import { createGenerationSessionController, scenarioCatalog } from "./core";
import { createEditorCommands, createHud } from "./editor";
import {
  createAuthorityBridge,
  createCameraRig,
  createLoop,
  createPlayerPresenceRenderer,
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
const playerPresenceRenderer = createPlayerPresenceRenderer(sceneState.presenceRoot);
let disposeBackendPresence = () => {};
let publishBackendTransform = (_transform: BackendPlayerTransform) => {};
let backendCommands: BackendLifecycleCommands | null = null;
let backendPresenceSnapshot: BackendPresenceSnapshot | null = null;
let backendSceneWorld: BackendPresenceSnapshot["authorityWorld"] = null;

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
  publishBackendTransform(cameraRig.getPresenceTransform());
});
loop.start();

const generation = createGenerationSessionController();
let renderBackendSnapshot: ((
  backendSnapshot: BackendPresenceSnapshot,
  fallbackSnapshot: ReturnType<typeof generation.getSnapshot>,
) => ReturnType<typeof generation.getSnapshot>) | null = null;
const editorCommands = createEditorCommands(generation);
const hud = createHud({
  root: hudRoot,
  scenarios: scenarioCatalog,
  onPromptSubmit(prompt) {
    if (backendCommands?.canHandle()) {
      void backendCommands.submitPrompt(prompt).catch((error: unknown) => {
        hud.setContextMessage(errorMessage(error, "Backend prompt failed"));
      });
      return;
    }

    editorCommands.submitPrompt(prompt);
  },
  onAction(actionId) {
    if (backendCommands?.canHandle()) {
      void backendCommands.dispatchAction(actionId).catch((error: unknown) => {
        hud.setContextMessage(errorMessage(error, "Backend action failed"));
      });
      return;
    }

    editorCommands.dispatchAction(actionId);
  },
  onInteractionStateChange(state) {
    cameraRig.controls.enabled = !state.controlsLocked;
  },
});
if (hasBackendConfig()) {
  void import("./backend")
    .then(
      ({
        createBackendGenerationSnapshot,
        createBackendLifecycleCommands,
        createBackendPresenceBridge,
      }) => {
        const backendPresence = createBackendPresenceBridge({
          onSnapshot(snapshot) {
            hud.setBackendPresence(snapshot);
            playerPresenceRenderer.sync(snapshot);
            backendPresenceSnapshot = snapshot;
            backendSceneWorld =
              snapshot.status === "connected" ? snapshot.authorityWorld : null;
            renderSnapshot();
          },
        });
        backendCommands = createBackendLifecycleCommands(backendPresence);
        disposeBackendPresence = () => backendPresence.dispose();
        publishBackendTransform = (transform) => {
          backendPresence.updateLocalTransform(transform);
        };
        publishBackendTransform(cameraRig.getPresenceTransform());
        renderBackendSnapshot = createBackendGenerationSnapshot;
      },
    )
    .catch((error: unknown) => {
      hud.setContextMessage(errorMessage(error, "Backend bridge failed to load"));
    });
}
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

function renderSnapshot() {
  const localSnapshot = generation.getSnapshot();
  const snapshot =
    backendPresenceSnapshot?.status === "connected" && renderBackendSnapshot
      ? renderBackendSnapshot(backendPresenceSnapshot, localSnapshot)
      : localSnapshot;
  const backendWorld =
    backendSceneWorld && backendSceneWorld.objects.length > 0 ? backendSceneWorld : null;
  const focusPoint = backendWorld
    ? authorityBridge.renderWorld(backendWorld)
    : authorityBridge.renderDocument(snapshot.document);
  cameraRig.focus(focusPoint);
  publishBackendTransform(cameraRig.getPresenceTransform());
  hud.setSnapshot(snapshot);
}

window.addEventListener("beforeunload", () => {
  disposeBackendPresence();
  unsubscribe();
  generation.dispose();
  authorityBridge.dispose();
  playerPresenceRenderer.dispose();
});

function hasBackendConfig() {
  return Boolean(
    import.meta.env.VITE_SPACETIMEDB_URI && import.meta.env.VITE_SPACETIMEDB_DATABASE,
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}
