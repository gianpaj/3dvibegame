import { useCallback, useEffect, useRef, useState } from "react";
import {
  createConfiguredAiWorkerClient,
  isMissingBrowserGeminiKeyError,
  pastePositionForTemplate,
  resolveAiClientMode,
  type ObjectCopyTemplate,
} from "./core";
import { createAiSession } from "./core/session/createAiSession";
import type { AiSessionSnapshot } from "./core/session/createAiSession";
import type { GenerationActionId } from "./core/session/generationSession";
import type {
  BackendLifecycleCommands,
  PendingObjectFeedback,
} from "./backend/createBackendLifecycleCommands";
import type {
  BackendPresenceBridge,
  BackendPresenceSnapshot,
} from "./backend/createBackendPresenceBridge";
import type { createBackendGenerationSnapshot } from "./backend/createBackendGenerationSnapshot";
import { GameCanvas, type SpawnPoint } from "./scene/GameCanvas";
import { GenerationCard } from "./components/GenerationCard";
import { FeedbackCard, type FeedbackRating } from "./components/FeedbackCard";
import { InfoButton } from "./components/InfoButton";
import {
  GeminiKeyModal,
  loadStoredGeminiKey,
} from "./components/GeminiKeyModal";
import { NameModal, loadStoredPlayerName } from "./components/NameModal";
import { PlayerList } from "./components/PlayerList";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { ChatPanel } from "./components/ChatPanel";
import { PromptInput } from "./components/PromptInput";
import { useSession } from "./hooks/useGenerationSession";
import { useChatTranscript } from "./hooks/useChatTranscript";
import { DEBUG } from "./debug";

const GENERATING_STAGES = new Set([
  "queued",
  "planning",
  "compiled_artifact_ready",
]);

const DISABLED_BACKEND_SNAPSHOT: BackendPresenceSnapshot = {
  enabled: false,
  status: "disabled",
  message: "Local room",
  nickname: "You",
  onlineCount: 0,
  world: null,
  players: [],
  avatars: [],
  authorityWorld: null,
  archiveAuthorityWorld: null,
  objectArtifacts: [],
  aiJobs: [],
  worldSnapshots: [],
  snapshotObjects: [],
  chatMessages: [],
};

interface ObjectClipboardState {
  template: ObjectCopyTemplate;
  pasteCount: number;
}

export function App() {
  // --- Gemini key ---
  const [geminiKey, setGeminiKey] = useState<string | null>(() =>
    loadStoredGeminiKey(),
  );
  const [viewerMode, setViewerMode] = useState(false);
  const geminiKeyRef = useRef(geminiKey);
  useEffect(() => {
    geminiKeyRef.current = geminiKey;
  }, [geminiKey]);

  // --- Player name (asked on first load) ---
  const [playerName, setPlayerName] = useState<string | null>(() =>
    loadStoredPlayerName(),
  );
  const playerNameRef = useRef(playerName);
  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  // --- AI session (stable, never recreated) ---
  const sessionRef = useRef<ReturnType<typeof createAiSession> | null>(null);
  if (!sessionRef.current) {
    const aiClient = createConfiguredAiWorkerClient({
      getBrowserGeminiApiKey: () => geminiKeyRef.current,
    });
    sessionRef.current = createAiSession(aiClient);
  }
  const snapshot = useSession(sessionRef.current);

  // --- Backend presence ---
  const [backendSnap, setBackendSnap] = useState<BackendPresenceSnapshot>(
    DISABLED_BACKEND_SNAPSHOT,
  );
  const [contextMsg, setContextMsg] = useState("");
  const [pendingFeedback, setPendingFeedback] =
    useState<PendingObjectFeedback | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  // Avatar prompt mode: the prompt box re-creates the player's body instead of
  // creating/editing a world object. Toggled from the PlayerList "Edit avatar".
  const [avatarMode, setAvatarMode] = useState(false);
  const selectedObjectIdRef = useRef<string | null>(null);
  const backendCommandsRef = useRef<BackendLifecycleCommands | null>(null);
  const backendSnapshotFnRef = useRef<
    typeof createBackendGenerationSnapshot | null
  >(null);
  const bridgeRef = useRef<BackendPresenceBridge | null>(null);
  const spawnPointRef = useRef<(() => SpawnPoint) | null>(null);
  const objectClipboardRef = useRef<ObjectClipboardState | null>(null);

  // Connect to the backend once the player has entered a name (so we join the
  // world with their chosen nickname). Recreated cleanly across React StrictMode's
  // dev mount/unmount/mount, so reloads always reconnect and show the live world.
  useEffect(() => {
    if (!hasBackendConfig() || !playerName) return;
    let alive = true;
    let localBridge: BackendPresenceBridge | null = null;

    void import("./backend").then(
      ({
        createBackendPresenceBridge,
        createBackendLifecycleCommands,
        createBackendGenerationSnapshot: createSnapshotFn,
      }) => {
        if (!alive) return;
        const aiClient = createConfiguredAiWorkerClient({
          getBrowserGeminiApiKey: () => geminiKeyRef.current,
        });
        const bridge = createBackendPresenceBridge({
          onSnapshot: setBackendSnap,
          nickname: playerNameRef.current ?? undefined,
        });
        localBridge = bridge;
        bridgeRef.current = bridge;
        backendCommandsRef.current = createBackendLifecycleCommands(
          bridge,
          aiClient,
          {
            getSelectedObjectId: () => selectedObjectIdRef.current,
            getSpawnPoint: () =>
              spawnPointRef.current?.() ?? { x: 0, y: 0, z: 0 },
            onOperation: (feedback) => setPendingFeedback(feedback),
          },
        );
        backendSnapshotFnRef.current = createSnapshotFn;
      },
    );

    return () => {
      alive = false;
      localBridge?.dispose();
      if (bridgeRef.current === localBridge) {
        bridgeRef.current = null;
        backendCommandsRef.current = null;
      }
    };
  }, [playerName]);

  // Dispose the in-memory session on unmount.
  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
    };
  }, []);

  // --- Derive display state ---
  const isLive = backendSnap.status === "connected";

  // In backend mode wrap into a compatible AiSessionSnapshot shape
  const displaySnapshot: AiSessionSnapshot = (() => {
    if (isLive && backendSnapshotFnRef.current) {
      const merged = backendSnapshotFnRef.current(
        backendSnap,
        snapshot as never,
        selectedObjectId,
      );
      return {
        document: merged.document,
        world: merged.world,
        stage: merged.stage,
        lastMessage: merged.lastMessage,
        stageEvents: merged.stageEvents,
        object: merged.object,
        availableActions: merged.availableActions,
      };
    }
    return snapshot;
  })();

  // Local AI generation transcript — kept for DEBUG only (see debug.ts).
  const { messages: aiTranscript, appendPlayerMessage } =
    useChatTranscript(displaySnapshot);

  const effectiveSelectedId = isLive
    ? selectedObjectId
    : (displaySnapshot.document.player_sessions_by_id["player_1"]?.selection
        .selected_object_id ?? null);

  const needsApiKey =
    resolveAiClientMode() === "browser-gemini" && !geminiKey && !viewerMode;
  const inputDisabled =
    viewerMode || GENERATING_STAGES.has(displaySnapshot.stage);

  // A manually-clicked object in a live room (we hold its lock) → the prompt box
  // edits that object with AI instead of creating a new one.
  const editing = isLive && selectedObjectId !== null;

  // WASD moves the object when one is selected (local or live), else moves the camera.
  const hasSelectedObjectRef = useRef(false);
  hasSelectedObjectRef.current = !viewerMode && displaySnapshot.object !== null;

  const handleMoveObject = useCallback((dx: number, dy: number, dz: number) => {
    if (backendCommandsRef.current?.canHandle()) {
      void backendCommandsRef.current
        .moveSelectedObject(dx, dy, dz)
        .catch((err: unknown) =>
          setContextMsg(errorMessage(err, "Move failed")),
        );
      return;
    }
    sessionRef.current?.moveSelected(dx, dy, dz);
  }, []);

  // Local avatar transform → move_player (already gated 10 Hz / on-change by the
  // controller; the bridge applies a second epsilon/throttle pass before sending).
  const handleAvatarMove = useCallback(
    (sample: {
      positionX: number;
      positionY: number;
      positionZ: number;
      rotationYaw: number;
    }) => {
      bridgeRef.current?.updateLocalTransform({ ...sample, rotationPitch: 0 });
    },
    [],
  );

  const handleDeselect = useCallback(() => {
    if (backendCommandsRef.current?.canHandle()) {
      // releaseSelectedLock captures the current selection synchronously before its
      // first await, so clearing the refs right after is safe.
      void backendCommandsRef.current.releaseSelectedLock().catch(() => {});
      setSelectedObjectId(null);
      selectedObjectIdRef.current = null;
    } else {
      sessionRef.current?.selectObject(null);
    }
  }, []);

  // 30-second selection lock: a selected object auto-unlocks (deselects) after the
  // window unless the player ends it early via Release/Done. Re-selecting restarts it.
  useEffect(() => {
    if (effectiveSelectedId === null) return;
    const timer = window.setTimeout(handleDeselect, 30_000);
    return () => window.clearTimeout(timer);
  }, [effectiveSelectedId, handleDeselect]);

  // Esc exits avatar mode (if active) else deselects the current object.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (avatarMode) {
        setAvatarMode(false);
        return;
      }
      if (hasSelectedObjectRef.current) handleDeselect();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDeselect, avatarMode]);

  const handleEditAvatar = useCallback(() => {
    setContextMsg("");
    setAvatarMode(true);
  }, []);

  // --- Handlers ---
  async function handlePromptSubmit(prompt: string): Promise<void> {
    setContextMsg("");
    appendPlayerMessage(prompt);

    // Avatar mode: re-create the local player's body, keep current body on failure.
    if (avatarMode && backendCommandsRef.current?.canHandle()) {
      try {
        await backendCommandsRef.current.editAvatar(prompt);
        setAvatarMode(false);
      } catch (err: unknown) {
        if (isMissingBrowserGeminiKeyError(err)) setGeminiKey(null);
        else setContextMsg(errorMessage(err, "Avatar update failed"));
        console.error(err);
        throw err;
      }
      return;
    }

    if (backendCommandsRef.current?.canHandle()) {
      const editingNow = selectedObjectIdRef.current !== null;
      const action = editingNow
        ? backendCommandsRef.current.editSelectedObject(prompt)
        : backendCommandsRef.current.submitPrompt(prompt);
      try {
        await action;
      } catch (err: unknown) {
        if (isMissingBrowserGeminiKeyError(err)) {
          setGeminiKey(null);
        } else {
          setContextMsg(
            errorMessage(err, editingNow ? "Edit failed" : "Prompt failed"),
          );
        }
        console.error(err);
        throw err;
      }
      return;
    }
    try {
      await sessionRef.current?.submitPrompt(prompt);
    } catch (err: unknown) {
      if (isMissingBrowserGeminiKeyError(err)) setGeminiKey(null);
      else setContextMsg(errorMessage(err, "Generation failed"));
      throw err;
    }
  }

  function handleDispatch(actionId: GenerationActionId) {
    setContextMsg("");
    const usingBackend = backendCommandsRef.current?.canHandle() ?? false;
    console.log(
      "[handleDispatch] actionId=%s usingBackend=%s",
      actionId,
      usingBackend,
    );
    if (usingBackend) {
      void backendCommandsRef
        .current!.dispatchAction(actionId)
        .then(() => {
          if (actionId === "release_object") handleDeselect();
        })
        .catch((err: unknown) => {
          setContextMsg(errorMessage(err, "Action failed"));
        });
      return;
    }
    sessionRef.current?.dispatch(actionId);
    console.log(
      "[handleDispatch] local session snapshot after dispatch:",
      sessionRef.current?.getSnapshot(),
    );
  }

  function handleSelectObject(objectId: string) {
    if (backendCommandsRef.current?.canHandle()) {
      setContextMsg("");
      // Only one object can be selected at a time: release the previously selected
      // object's lock before locking the new one. releaseSelectedLock reads the
      // current selection synchronously, so call it before updating the ref.
      if (
        selectedObjectIdRef.current &&
        selectedObjectIdRef.current !== objectId
      ) {
        void backendCommandsRef.current.releaseSelectedLock().catch(() => {});
      }
      setSelectedObjectId(objectId);
      selectedObjectIdRef.current = objectId;
      // Acquire an exclusive edit lock; if another player holds it, undo selection.
      void backendCommandsRef.current
        .lockSelectedObject()
        .catch((err: unknown) => {
          setSelectedObjectId(null);
          selectedObjectIdRef.current = null;
          setContextMsg(errorMessage(err, "Can't edit that object"));
        });
    } else {
      sessionRef.current?.selectObject(objectId);
    }
  }

  function handleDelete() {
    setContextMsg("");
    if (backendCommandsRef.current?.canHandle()) {
      void backendCommandsRef.current
        .deleteSelectedObject()
        .then(() => handleDeselect())
        .catch((err: unknown) =>
          setContextMsg(errorMessage(err, "Delete failed")),
        );
      return;
    }
    sessionRef.current?.deleteSelected();
  }

  const canCopySelectedObject = useCallback(() => {
    if (viewerMode) return false;
    if (backendCommandsRef.current?.canHandle()) {
      return backendCommandsRef.current.canCopySelectedObject();
    }
    return sessionRef.current?.canCopySelectedObject() ?? false;
  }, [viewerMode]);

  const copySelectedObjectTemplate = useCallback(() => {
    if (backendCommandsRef.current?.canHandle()) {
      return backendCommandsRef.current.copySelectedObject();
    }
    const template = sessionRef.current?.copySelectedObject();
    if (!template) {
      throw new Error("Select an object before copying it.");
    }
    return template;
  }, []);

  const pasteObjectTemplate = useCallback(
    async (template: ObjectCopyTemplate, pasteCount: number) => {
      const pastePoint = pastePositionForTemplate(
        template,
        pasteCount,
        spawnPointRef.current?.() ?? { x: 0, y: 0, z: 0 },
      );

      if (backendCommandsRef.current?.canHandle()) {
        await backendCommandsRef.current.releaseSelectedObjectForPaste();
        const objectId = await backendCommandsRef.current.pasteCopiedObject(
          template,
          pastePoint,
        );
        setSelectedObjectId(objectId);
        selectedObjectIdRef.current = objectId;
        return objectId;
      }

      sessionRef.current?.releaseSelectedObjectForPaste();
      return sessionRef.current?.pasteCopiedObject(template, pastePoint);
    },
    [],
  );

  const handleCopySelectedObject = useCallback(() => {
    setContextMsg("");
    try {
      const template = copySelectedObjectTemplate();
      objectClipboardRef.current = { template, pasteCount: 0 };
      setContextMsg(`Copied ${template.category}.`);
    } catch (err: unknown) {
      setContextMsg(errorMessage(err, "Copy failed"));
    }
  }, [copySelectedObjectTemplate]);

  const handlePasteCopiedObject = useCallback(async () => {
    setContextMsg("");
    const clipboard = objectClipboardRef.current;
    if (!clipboard) {
      setContextMsg("Copy an object before pasting.");
      return;
    }

    try {
      await pasteObjectTemplate(clipboard.template, clipboard.pasteCount);
      clipboard.pasteCount += 1;
      setContextMsg(`Pasted ${clipboard.template.category}.`);
    } catch (err: unknown) {
      setContextMsg(errorMessage(err, "Paste failed"));
    }
  }, [pasteObjectTemplate]);

  const handleDuplicateSelectedObject = useCallback(async () => {
    setContextMsg("");
    try {
      const template = copySelectedObjectTemplate();
      await pasteObjectTemplate(template, 0);
      setContextMsg(`Duplicated ${template.category}.`);
    } catch (err: unknown) {
      setContextMsg(errorMessage(err, "Duplicate failed"));
    }
  }, [copySelectedObjectTemplate, pasteObjectTemplate]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (key !== "c" && key !== "v") return;
      if (isEditableTarget(event.target)) return;

      if (key === "c") {
        if (!canCopySelectedObject()) return;
        event.preventDefault();
        handleCopySelectedObject();
        return;
      }

      if (!objectClipboardRef.current) return;
      event.preventDefault();
      void handlePasteCopiedObject();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canCopySelectedObject,
    handleCopySelectedObject,
    handlePasteCopiedObject,
  ]);

  function handleRateFeedback({
    operationId,
    rating,
  }: {
    operationId: string;
    rating: FeedbackRating;
  }) {
    const pending = pendingFeedback;
    if (!pending || pending.operationId !== operationId) return;
    // Fire-and-forget: the card already hid itself; clear our copy too. A rejected
    // submit (e.g. double rate after reconnect) is a no-op for the player.
    setPendingFeedback(null);
    void bridgeRef.current
      ?.submitObjectFeedback({ ...pending, rating })
      .catch(() => {});
  }

  function handleApiKeySave(key: string) {
    setGeminiKey(key);
    geminiKeyRef.current = key;
    setViewerMode(false);
  }

  function handleJoinAsViewer() {
    setViewerMode(true);
  }

  function handleNameSave(name: string) {
    setPlayerName(name);
    playerNameRef.current = name;
  }

  async function handleSendChat(text: string): Promise<void> {
    try {
      await bridgeRef.current?.sendChat(text);
    } catch (err: unknown) {
      setContextMsg(errorMessage(err, "Chat failed"));
      throw err;
    }
  }

  function handleDeleteChat(messageId: string) {
    void bridgeRef.current
      ?.deleteChatMessage(messageId)
      .catch((err: unknown) =>
        setContextMsg(errorMessage(err, "Delete failed")),
      );
  }

  // The local player can moderate (delete others' messages) when their backend role is
  // host/moderator/platform_admin.
  const localRole = backendSnap.players.find((player) => player.isLocal)?.role;
  const canModerateChat =
    localRole === "host" ||
    localRole === "moderator" ||
    localRole === "platform_admin";
  const canDuplicateSelected = canCopySelectedObject();

  return (
    <div className="app-root">
      <div className="canvas-wrapper">
        <GameCanvas
          document={displaySnapshot.document}
          selectedObjectId={effectiveSelectedId}
          onSelectObject={viewerMode ? undefined : handleSelectObject}
          hasSelectedObjectRef={hasSelectedObjectRef}
          onMoveObject={handleMoveObject}
          onDeselect={handleDeselect}
          spawnPointRef={spawnPointRef}
          players={isLive ? backendSnap.players : undefined}
          avatars={backendSnap.avatars}
          onAvatarMove={handleAvatarMove}
        />
      </div>

      <div className="hud-overlay">
        <div className="hud-top-left">
          <ConnectionStatus
            status={backendSnap.status}
            message={backendSnap.message}
          />
          <PlayerList
            players={backendSnap.players}
            onEditAvatar={isLive && !viewerMode ? handleEditAvatar : undefined}
          />
          {contextMsg && <p className="context-msg">{contextMsg}</p>}
          <ChatPanel
            messages={backendSnap.chatMessages}
            onSend={handleSendChat}
            onDelete={handleDeleteChat}
            canModerate={canModerateChat}
            disabled={!isLive}
            debugMessages={DEBUG ? aiTranscript : undefined}
          />
        </div>

        <div className="hud-bottom-left">
          <InfoButton />
        </div>

        <div className="hud-top-right">
          {viewerMode ? (
            <div className="viewer-card">
              <p className="viewer-card-message">
                You&apos;re viewing as a guest. Add your Gemini API key to
                create and edit objects.
              </p>
              <button
                className="viewer-card-cta"
                onClick={() => setViewerMode(false)}
              >
                Add Gemini key
              </button>
            </div>
          ) : (
            <GenerationCard
              snapshot={displaySnapshot}
              onDispatch={handleDispatch}
              onDelete={handleDelete}
              onDuplicate={handleDuplicateSelectedObject}
              canDuplicate={canDuplicateSelected}
            />
          )}
          <FeedbackCard
            operation={pendingFeedback}
            onRate={handleRateFeedback}
            viewerMode={viewerMode}
            offline={!isLive}
          />
        </div>

        <div className="hud-bottom">
          <PromptInput
            onSubmit={handlePromptSubmit}
            disabled={inputDisabled}
            editing={editing}
            avatarMode={avatarMode}
            onExitAvatarMode={() => setAvatarMode(false)}
            placeholder={
              viewerMode ? "Add a Gemini key to create objects…" : undefined
            }
          />
        </div>
      </div>

      {!playerName ? (
        <NameModal onSave={handleNameSave} />
      ) : needsApiKey ? (
        <GeminiKeyModal
          onSave={handleApiKeySave}
          onDismiss={handleJoinAsViewer}
        />
      ) : null}
    </div>
  );
}

function hasBackendConfig() {
  return Boolean(
    import.meta.env.VITE_SPACETIMEDB_URI &&
    import.meta.env.VITE_SPACETIMEDB_DATABASE,
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message)
    return `${fallback}: ${error.message}`;
  return fallback;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable
  );
}
