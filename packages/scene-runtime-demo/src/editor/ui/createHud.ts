import type { GenerationActionId, GenerationSnapshot } from "../../core";
import type { ScenarioKey } from "../../core";
import type { BackendPresenceSnapshot } from "../../backend";

interface ScenarioOption {
  key: ScenarioKey;
  label: string;
  description: string;
  sourcePrompt: string;
}

type HudPanel = "build" | "chat" | "players" | "debug" | "settings";
type FeedbackVote = "up" | "down" | null;
type ShareState = "idle" | "copied";
type InputMode = "play" | "panel" | "prompt";
type HudWorkflowState =
  | "idle"
  | "queued"
  | "generating"
  | "grace"
  | "refining"
  | "released"
  | "failed";
type HudMultiplayerMode = "local" | "connecting" | "live" | "offline" | "error";
type ChatMessageRole = "player" | "system" | "event";

interface ChatTranscriptMessage {
  id: string;
  role: ChatMessageRole;
  label: string;
  text: string;
  status?: "pending" | "complete" | "error";
  timestamp?: string;
}

export interface HudInteractionState {
  activePanel: HudPanel | "none";
  inputMode: InputMode;
  workflowState: HudWorkflowState;
  multiplayerMode: HudMultiplayerMode;
  feedbackVote: FeedbackVote;
  feedbackNote: string;
  muted: boolean;
  shareState: ShareState;
  controlsLocked: boolean;
}

interface HudConfig {
  root: HTMLElement;
  scenarios: ScenarioOption[];
  onPromptSubmit(prompt: string): void;
  onAction(actionId: GenerationActionId): void;
  onInteractionStateChange?(state: HudInteractionState): void;
}

const actionLabels: Record<GenerationActionId, string> = {
  refine_silhouette: "Refine silhouette",
  add_ornament: "Add ornament",
  nudge_draft: "Move",
  rotate_draft: "Rotate",
  scale_draft: "Scale",
  release_object: "Release",
};

const actionDescriptions: Record<GenerationActionId, string> = {
  refine_silhouette: "Broaden the stance and make the character read clearly at distance.",
  add_ornament: "Add the chest rune and shoulder details for stronger identity.",
  nudge_draft: "Shift the avatar slightly in the preview.",
  rotate_draft: "Turn the avatar to inspect its silhouette.",
  scale_draft: "Increase the avatar scale a little.",
  release_object: "Publish the draft so refine steps can start.",
};

const stageLabels = {
  idle: "Ready",
  queued: "Queued",
  planning: "Planning",
  voxel_source_ready: "Voxel source",
  compiled_artifact_ready: "Compiled",
  grace: "Draft ready",
  edit_locked: "Edit lock",
  cooldown: "Cooldown",
  released: "Synced",
  failed: "Needs attention",
} as const;

const workflowLabels: Record<HudWorkflowState, string> = {
  idle: "Idle",
  queued: "Queued",
  generating: "Generating",
  grace: "Grace",
  refining: "Refining",
  released: "Released",
  failed: "Failed",
};

export function createHud({
  root,
  scenarios,
  onPromptSubmit,
  onAction,
  onInteractionStateChange,
}: HudConfig) {
  const initialPrompt = scenarios[0]?.sourcePrompt ?? "";
  let activePanel: HudPanel | null = null;
  let feedbackVote: FeedbackVote = null;
  let feedbackNote = "";
  let feedbackTargetKey: string | null = null;
  let muted = false;
  let shareState: ShareState = "idle";
  let latestSnapshot: GenerationSnapshot | null = null;
  let latestBackendPresence: BackendPresenceSnapshot | null = null;
  let chatSequence = 0;
  let chatMessages: ChatTranscriptMessage[] = [];
  const seenStageEventIds = new Set<string>();
  let promptFocused = false;

  root.innerHTML = `
    <div class="hud-shell" data-role="hud-shell" data-panel="none" data-mode="play">
      <header class="hud-roombar" aria-label="Room status">
        <div class="room-card">
          <div class="room-card__mark" aria-hidden="true">3D</div>
          <div class="room-card__copy">
            <strong>Avatar Grove</strong>
            <span data-role="room-subtitle">Private multiplayer room</span>
          </div>
        </div>

        <div class="status-strip" aria-live="polite">
          <span class="status-pill" data-role="stage-pill" data-state="idle">Ready</span>
          <span class="status-pill status-pill--sync" data-role="sync-pill">Scene synced</span>
          <span class="status-pill" data-role="presence-pill">Local room</span>
        </div>

        <div class="top-actions" aria-label="Room actions">
          <button type="button" data-panel="players">Players</button>
          <button type="button" data-action="share">Invite</button>
          <button type="button" data-panel="settings">Settings</button>
        </div>
      </header>

      <nav class="tool-rail" aria-label="Creator tools">
        <button type="button" data-panel="build">Build</button>
        <button type="button" data-panel="chat">Chat</button>
        <button type="button" data-panel="players">Crew</button>
        <button type="button" data-panel="debug">Debug</button>
      </nav>

      <aside class="side-sheet" data-role="side-panel" aria-hidden="true"></aside>

      <section class="presence-strip" data-role="presence-strip" aria-label="Players in room"></section>

      <section class="companion-card" data-role="companion-card" aria-live="polite"></section>

      <section class="action-dock" data-role="action-dock" aria-live="polite"></section>

      <section class="feedback-dock" data-role="feedback-dock" aria-label="Generation feedback"></section>

      <form class="prompt-dock" data-role="prompt-form">
        <label class="sr-only" for="creator-prompt">Chat or create</label>
        <textarea
          id="creator-prompt"
          rows="1"
          data-role="prompt-input"
          placeholder="Ask Savi to add, refine, or explain something in the world..."
        ></textarea>
        <button class="send-button" type="submit">Send</button>
      </form>

      <div class="context-toast" data-role="context-message" data-state="hidden"></div>
    </div>
  `;

  const shell = required<HTMLElement>(root, '[data-role="hud-shell"]');
  const form = required<HTMLFormElement>(root, '[data-role="prompt-form"]');
  const promptInput = required<HTMLTextAreaElement>(root, '[data-role="prompt-input"]');
  const sidePanel = required<HTMLElement>(root, '[data-role="side-panel"]');
  const presenceStrip = required<HTMLElement>(root, '[data-role="presence-strip"]');
  const companionCard = required<HTMLElement>(root, '[data-role="companion-card"]');
  const actionDock = required<HTMLElement>(root, '[data-role="action-dock"]');
  const feedbackDock = required<HTMLElement>(root, '[data-role="feedback-dock"]');
  const stagePill = required<HTMLElement>(root, '[data-role="stage-pill"]');
  const syncPill = required<HTMLElement>(root, '[data-role="sync-pill"]');
  const presencePill = required<HTMLElement>(root, '[data-role="presence-pill"]');
  const roomSubtitle = required<HTMLElement>(root, '[data-role="room-subtitle"]');
  const contextMessage = required<HTMLElement>(root, '[data-role="context-message"]');

  promptInput.value = initialPrompt;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) {
      setContextMessage("Type a message before sending it to Savi.");
      return;
    }

    activePanel = "chat";
    appendChatMessage({
      role: "player",
      label: "You",
      text: prompt,
    });
    render();
    onPromptSubmit(prompt);
  });

  promptInput.addEventListener("focus", () => {
    promptFocused = true;
    emitInteractionState();
  });

  promptInput.addEventListener("blur", () => {
    promptFocused = false;
    emitInteractionState();
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) return;

    const panel = button.dataset.panel as HudPanel | undefined;
    const action = button.dataset.action;
    const prompt = button.dataset.prompt;
    const refineAction = button.dataset.refine as GenerationActionId | undefined;
    const vote = button.dataset.vote as Exclude<FeedbackVote, null> | undefined;

    if (panel) {
      activePanel = activePanel === panel ? null : panel;
      render();
      return;
    }

    if (prompt !== undefined) {
      promptInput.value = prompt;
      promptInput.focus();
      activePanel = "chat";
      render();
      return;
    }

    if (refineAction) {
      onAction(refineAction);
      return;
    }

    if (vote) {
      feedbackVote = feedbackVote === vote ? null : vote;
      setContextMessage(
        feedbackVote === "up"
          ? "Marked this generation as useful."
          : feedbackVote === "down"
            ? "Marked this generation for follow-up."
            : "Cleared generation feedback.",
      );
      render();
      return;
    }

    switch (action) {
      case "close-panel":
        activePanel = null;
        render();
        break;
      case "share":
        void copyInviteLink();
        break;
      case "mute":
        muted = !muted;
        setContextMessage(muted ? "Room audio muted." : "Room audio unmuted.");
        render();
        break;
      case "focus-prompt":
        activePanel = "chat";
        render();
        promptInput.focus();
        break;
      default:
        break;
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role !== "feedback-note") return;

    feedbackNote = target.value;
    const summary = target.closest(".feedback-card")?.querySelector("small");
    if (summary) {
      summary.textContent = feedbackSummary();
    }
    emitInteractionState();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePanel) {
      activePanel = null;
      render();
    }
  });

  return {
    setSnapshot(snapshot: GenerationSnapshot) {
      latestSnapshot = snapshot;
      syncChatTranscript(snapshot);
      resetFeedbackForNewTarget(snapshot);

      if (document.activeElement !== promptInput) {
        promptInput.value = snapshot.sourcePrompt;
      }

      render();
    },
    setBackendPresence(snapshot: BackendPresenceSnapshot) {
      latestBackendPresence = snapshot;
      render();
    },
    setContextMessage,
  };

  function render() {
    if (!latestSnapshot) {
      updateInteractionAttributes();
      emitInteractionState();
      return;
    }

    const snapshot = latestSnapshot;
    const workflowState = resolveWorkflowState(snapshot);

    roomSubtitle.textContent = roomSubtitleLabel(snapshot, latestBackendPresence);

    stagePill.textContent = workflowLabels[workflowState];
    stagePill.dataset.state = resolveWorkflowPillState(workflowState);
    stagePill.dataset.workflow = workflowState;
    syncPill.textContent = syncLabel(snapshot, latestBackendPresence);
    syncPill.dataset.state = syncState(snapshot, latestBackendPresence);
    presencePill.textContent = presenceLabel(latestBackendPresence);
    presencePill.dataset.state = presenceState(latestBackendPresence);

    presenceStrip.innerHTML = renderPresence(snapshot);
    companionCard.innerHTML = renderCompanion(snapshot);
    actionDock.innerHTML = renderActionDock(snapshot);
    feedbackDock.innerHTML = renderFeedback(snapshot);
    sidePanel.innerHTML = activePanel ? renderSidePanel(activePanel, snapshot) : "";
    if (activePanel === "chat") {
      scrollChatToLatest();
    }

    updateInteractionAttributes();
    updatePressedStates();
    emitInteractionState();
  }

  function renderSidePanel(panel: HudPanel, snapshot: GenerationSnapshot) {
    const title = {
      build: "Build menu",
      chat: "Savi chat",
      players: "Players",
      debug: "Pipeline",
      settings: "Settings",
    }[panel];

    return `
      <div class="sheet-header">
        <div>
          <span class="sheet-kicker">${escapeHtml(title)}</span>
          <strong>${escapeHtml(sheetSubtitle(panel, snapshot))}</strong>
        </div>
        <button type="button" data-action="close-panel">Close</button>
      </div>
      ${panel === "build" ? renderBuildPanel(snapshot) : ""}
      ${panel === "chat" ? renderChatPanel(snapshot) : ""}
      ${panel === "players" ? renderPlayersPanel(snapshot) : ""}
      ${panel === "debug" ? renderDebugPanel(snapshot) : ""}
      ${panel === "settings" ? renderSettingsPanel(snapshot) : ""}
    `;
  }

  function renderBuildPanel(snapshot: GenerationSnapshot) {
    const workflowState = resolveWorkflowState(snapshot);

    return `
      <section class="sheet-section">
        <h2>Quick prompts</h2>
        <div class="prompt-chip-grid">
          ${scenarios
            .map(
              (scenario) => `
                <button
                  class="prompt-chip"
                  type="button"
                  data-prompt="${escapeHtml(scenario.sourcePrompt)}"
                >
                  <span>${escapeHtml(scenario.label)}</span>
                  <small>${escapeHtml(scenario.description)}</small>
                </button>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="sheet-section">
        <h2>Generation status</h2>
        <div class="metric-grid">
          ${metric("State", workflowLabels[workflowState])}
          ${metric("Stage", stageLabels[snapshot.stage])}
          ${metric("Recipe", snapshot.matchedScenarioLabel)}
          ${metric("Version", snapshot.object ? `v${snapshot.object.version}` : "none")}
          ${metric("Lifecycle", lifecycleStatusLabel(snapshot))}
          ${metric("Parts", partCountLabel(snapshot))}
        </div>
      </section>
    `;
  }

  function renderChatPanel(snapshot: GenerationSnapshot) {
    const messages = chatMessages.length
      ? chatMessages
      : [
          {
            id: "chat_initial",
            role: "system",
            label: "Savi",
            text: snapshot.lastMessage,
          } satisfies ChatTranscriptMessage,
        ];

    return `
      <section class="sheet-section chat-log">
        ${messages.map(renderChatMessage).join("")}
      </section>
    `;
  }

  function renderPlayersPanel(snapshot: GenerationSnapshot) {
    return `
      <section class="sheet-section">
        <h2>Room crew</h2>
        <div class="player-list">
          ${roomPlayers(snapshot, latestBackendPresence)
            .map(
              (player) => `
                <div class="player-row" data-state="${player.state}">
                  <span class="player-avatar">${escapeHtml(player.initials)}</span>
                  <div>
                    <strong>${escapeHtml(player.name)}</strong>
                    <small>${escapeHtml(player.detail)}</small>
                  </div>
                  <em>${escapeHtml(player.status)}</em>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderDebugPanel(snapshot: GenerationSnapshot) {
    const backendArtifact = backendArtifactForSnapshot(snapshot, latestBackendPresence);

    return `
      <section class="sheet-section">
        <h2>Stage timeline</h2>
        <ol class="stage-list">
          ${
            snapshot.stageEvents.length
              ? snapshot.stageEvents
                  .map(
                    (event) => `
                      <li class="stage-event" data-status="${event.status}" data-stage="${event.stage}">
                        <div class="stage-event__meta">
                          <strong>${escapeHtml(stageLabels[event.stage])}</strong>
                          <time>${escapeHtml(formatTimestamp(event.timestamp))}</time>
                        </div>
                        <span>${escapeHtml(event.message)}</span>
                      </li>
                    `,
                  )
                  .join("")
              : `<li class="stage-event" data-status="pending" data-stage="idle"><span>No stage events yet.</span></li>`
          }
        </ol>
      </section>

      <section class="sheet-section">
        <h2>Artifacts</h2>
        <p>${escapeHtml(snapshot.voxelArtifact?.summary ?? "Voxel source not ready.")}</p>
        <p>${escapeHtml(snapshot.compiledArtifact?.summary ?? "Runtime artifact not ready.")}</p>
        ${backendArtifact ? renderBackendArtifactDebug(backendArtifact) : ""}
        <details class="json-card">
          <summary>Authority world JSON</summary>
          <pre>${escapeHtml(prettyJson(snapshot.world))}</pre>
        </details>
      </section>
    `;
  }

  function renderSettingsPanel(snapshot: GenerationSnapshot) {
    const state = currentInteractionState();

    return `
      <section class="sheet-section">
        <h2>Interaction states</h2>
        <div class="metric-grid">
          ${metric("Input", state.inputMode)}
          ${metric("Panel", state.activePanel)}
          ${metric("Flow", workflowLabels[state.workflowState])}
          ${metric("Multiplayer", state.multiplayerMode)}
          ${metric("Feedback", feedbackSummary())}
          ${metric("Camera", state.controlsLocked ? "locked" : "free")}
          ${metric("Audio", muted ? "muted" : "on")}
          ${metric("Backend", backendStatusLabel(latestBackendPresence))}
        </div>
      </section>

      <section class="sheet-section settings-actions">
        <button type="button" data-action="mute">${muted ? "Unmute room" : "Mute room"}</button>
        <button type="button" data-action="focus-prompt">Focus chat</button>
        <p>${escapeHtml(snapshot.lastMessage)}</p>
      </section>
    `;
  }

  function renderCompanion(snapshot: GenerationSnapshot) {
    const workflowState = resolveWorkflowState(snapshot);
    const busy = workflowState === "queued" || workflowState === "generating";
    const latestEvent = snapshot.stageEvents[snapshot.stageEvents.length - 1];

    return `
      <div class="companion-card__header">
        <span class="companion-dot" data-state="${busy ? "busy" : "ready"}"></span>
        <strong>Savi</strong>
        <small>${escapeHtml(companionStateLabel(workflowState))}</small>
      </div>
      <p>${escapeHtml(latestEvent?.message ?? snapshot.lastMessage)}</p>
    `;
  }

  function renderActionDock(snapshot: GenerationSnapshot) {
    const workflowState = resolveWorkflowState(snapshot);

    if (workflowState === "failed") {
      return `
        <div class="dock-card dock-card--failed">
          <span>Action needed</span>
          <strong>${escapeHtml(stageLabels[snapshot.stage])}</strong>
          <p>${escapeHtml(snapshot.lastMessage)}</p>
        </div>
      `;
    }

    if (workflowState === "queued" || workflowState === "generating") {
      return `
        <div class="dock-card dock-card--busy">
          <span>AI turn</span>
          <strong>${escapeHtml(workflowLabels[workflowState])}</strong>
          <p>${escapeHtml(snapshot.lastMessage)}</p>
        </div>
      `;
    }

    if (workflowState === "refining" && snapshot.stage === "cooldown") {
      return `
        <div class="dock-card dock-card--busy">
          <span>Refinement cooldown</span>
          <strong>${escapeHtml(stageLabels[snapshot.stage])}</strong>
          <p>${escapeHtml(snapshot.lastMessage)}</p>
        </div>
      `;
    }

    if (!snapshot.object) {
      return "";
    }

    if (!snapshot.availableActions.length) {
      return `
        <div class="dock-card">
          <span>${escapeHtml(unavailableActionKicker(snapshot))}</span>
          <strong>${escapeHtml(unavailableActionTitle(snapshot))}</strong>
          <p>${escapeHtml(snapshot.lastMessage)}</p>
        </div>
      `;
    }

    return `
      <div class="dock-card dock-card--actions">
        <div>
          <span>Avatar actions</span>
          <strong>${escapeHtml(actionLabels[snapshot.availableActions[0]])}</strong>
          <p>${escapeHtml(actionDescriptions[snapshot.availableActions[0]])}</p>
        </div>
        ${snapshot.availableActions
          .map(
            (actionId) => `
              <button type="button" data-refine="${actionId}">
                ${escapeHtml(actionLabels[actionId])}
              </button>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderFeedback(snapshot: GenerationSnapshot) {
    if (!snapshot.object || snapshot.stage !== "released") {
      return "";
    }

    return `
      <div class="feedback-card">
        <span>Generation feedback</span>
        <div class="feedback-actions">
          <button type="button" data-vote="up" aria-pressed="${feedbackVote === "up"}">Good</button>
          <button type="button" data-vote="down" aria-pressed="${feedbackVote === "down"}">Needs work</button>
        </div>
        <input
          type="text"
          aria-label="Feedback note"
          data-role="feedback-note"
          value="${escapeHtml(feedbackNote)}"
          placeholder="Add a short note for the next pass"
        />
        <small>${escapeHtml(feedbackSummary())}</small>
      </div>
    `;
  }

  function renderPresence(snapshot: GenerationSnapshot) {
    return roomPlayers(snapshot, latestBackendPresence)
      .map(
        (player) => `
          <div class="presence-pill" data-state="${player.state}">
            <span>${escapeHtml(player.initials)}</span>
            <div>
              <strong>${escapeHtml(player.name)}</strong>
              <small>${escapeHtml(player.status)}</small>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderChatMessage(message: ChatTranscriptMessage) {
    return `
      <div class="chat-message chat-message--${message.role}" data-status="${message.status ?? "complete"}">
        <strong>${escapeHtml(message.label)}</strong>
        <p>${escapeHtml(message.text)}</p>
        ${message.timestamp ? `<time>${escapeHtml(formatTimestamp(message.timestamp))}</time>` : ""}
      </div>
    `;
  }

  function syncChatTranscript(snapshot: GenerationSnapshot) {
    if (!chatMessages.length) {
      appendChatMessage({
        id: "chat_initial",
        role: "system",
        label: "Savi",
        text: snapshot.lastMessage,
      });
    }

    snapshot.stageEvents.forEach((event) => {
      if (seenStageEventIds.has(event.id)) return;
      seenStageEventIds.add(event.id);
      appendChatMessage({
        id: `event_${event.id}`,
        role: "event",
        label: stageLabels[event.stage],
        text: event.message,
        status: event.status,
        timestamp: event.timestamp,
      });
    });
  }

  function appendChatMessage(message: Omit<ChatTranscriptMessage, "id"> & { id?: string }) {
    chatSequence += 1;
    chatMessages = [
      ...chatMessages,
      {
        ...message,
        id: message.id ?? `chat_${chatSequence}`,
      },
    ].slice(-32);
  }

  function scrollChatToLatest() {
    window.requestAnimationFrame(() => {
      const chatLog = sidePanel.querySelector<HTMLElement>(".chat-log");
      if (chatLog) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    });
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      shareState = "copied";
      setContextMessage("Invite link copied.");
    } catch {
      shareState = "idle";
      setContextMessage("Invite link is ready in the address bar.");
    }

    emitInteractionState();
    window.setTimeout(() => {
      shareState = "idle";
      emitInteractionState();
    }, 1600);
  }

  function setContextMessage(message: string) {
    contextMessage.textContent = message;
    contextMessage.dataset.state = message ? "visible" : "hidden";
  }

  function currentInteractionState(): HudInteractionState {
    const inputMode: InputMode = promptFocused ? "prompt" : activePanel ? "panel" : "play";

    return {
      activePanel: activePanel ?? "none",
      inputMode,
      workflowState: latestSnapshot ? resolveWorkflowState(latestSnapshot) : "idle",
      multiplayerMode: resolveMultiplayerMode(latestBackendPresence),
      feedbackVote,
      feedbackNote,
      muted,
      shareState,
      controlsLocked: inputMode !== "play",
    };
  }

  function resetFeedbackForNewTarget(snapshot: GenerationSnapshot) {
    const nextTargetKey = snapshot.object
      ? `${snapshot.object.object_id}:${snapshot.object.version}`
      : null;
    if (nextTargetKey === feedbackTargetKey) return;

    feedbackTargetKey = nextTargetKey;
    feedbackVote = null;
    feedbackNote = "";
  }

  function feedbackSummary() {
    const voteLabel =
      feedbackVote === "up"
        ? "good"
        : feedbackVote === "down"
          ? "needs work"
          : "none";
    const note = feedbackNote.trim();
    return note ? `${voteLabel} - ${note}` : voteLabel;
  }

  function emitInteractionState() {
    onInteractionStateChange?.(currentInteractionState());
  }

  function updateInteractionAttributes() {
    const state = currentInteractionState();
    shell.dataset.panel = state.activePanel;
    shell.dataset.mode = state.inputMode;
    shell.dataset.workflow = state.workflowState;
    shell.dataset.multiplayer = state.multiplayerMode;
    sidePanel.setAttribute("aria-hidden", activePanel ? "false" : "true");
  }

  function updatePressedStates() {
    root
      .querySelectorAll<HTMLButtonElement>("[data-panel]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          button.dataset.panel === activePanel ? "true" : "false",
        );
      });
  }
}

function roomPlayers(
  snapshot: GenerationSnapshot,
  backendPresence: BackendPresenceSnapshot | null,
) {
  if (backendPresence?.enabled && backendPresence.players.length) {
    return backendPresence.players.map((player) => ({
      initials: playerInitials(player.nickname),
      name: player.isLocal ? `${player.nickname} (you)` : player.nickname,
      detail: player.role,
      status: player.presenceState,
      state: player.presenceState === "active" ? "active" : "idle",
    }));
  }

  return [
    {
      initials: "YOU",
      name: "You",
      detail: "Creator profile",
      status: snapshot.object ? `avatar v${snapshot.object.version}` : "setting up",
      state: snapshot.stage === "failed" ? "blocked" : "active",
    },
    {
      initials: "MJ",
      name: "Mira",
      detail: "Playtester",
      status: "watching",
      state: "idle",
    },
    {
      initials: "AI",
      name: "Savi",
      detail: "AI companion",
      status: isBusy(snapshot) ? "generating" : "ready",
      state: isBusy(snapshot) ? "busy" : "active",
    },
  ];
}

function playerInitials(nickname: string) {
  const parts = nickname.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function roomSubtitleLabel(
  snapshot: GenerationSnapshot,
  backendPresence: BackendPresenceSnapshot | null,
) {
  if (backendPresence?.enabled && backendPresence.world) {
    const objectCount = backendPresence.authorityWorld?.objects.length ?? 0;
    const objectLabel = objectCount === 1 ? "1 object" : `${objectCount} objects`;
    return `${backendPresence.world.visibility} room - ${backendPresence.onlineCount}/${backendPresence.world.maxPlayers} online - ${objectLabel}`;
  }

  if (backendPresence?.enabled) {
    return backendStatusLabel(backendPresence);
  }

  return snapshot.object
    ? `Private room - avatar v${snapshot.object.version} - ${snapshot.object.state}`
    : "Private multiplayer room - local authority";
}

function sheetSubtitle(panel: HudPanel, snapshot: GenerationSnapshot) {
  switch (panel) {
    case "build":
      return snapshot.object ? `Avatar v${snapshot.object.version}` : "Start from a prompt";
    case "chat":
      return "Room conversation and AI turns";
    case "players":
      return "Live profiles and presence";
    case "debug":
      return "Stage events and authority state";
    case "settings":
      return "Input, camera, and room controls";
    default:
      panel satisfies never;
      return "";
  }
}

function metric(label: string, value: string) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function lifecycleStatusLabel(snapshot: GenerationSnapshot) {
  const object = snapshot.object;
  if (!object) return "none";

  switch (object.state) {
    case "draft":
    case "grace":
      return `${object.grace_remaining_seconds}s grace`;
    case "edit_locked":
      return "edit lock";
    case "cooldown":
      return `${object.cooldown_remaining_seconds}s cooldown`;
    case "public":
      return "public";
    case "archived":
      return "archived";
    case "deleted":
      return "deleted";
    default:
      object.state satisfies never;
      return "unknown";
  }
}

function partCountLabel(snapshot: GenerationSnapshot) {
  if (snapshot.compiledArtifact) {
    return String(snapshot.compiledArtifact.payload.complexity.part_count);
  }
  return snapshot.object ? String(snapshot.object.builder_spec.complexity.part_count) : "0";
}

function unavailableActionKicker(snapshot: GenerationSnapshot) {
  const state = snapshot.object?.state;

  switch (state) {
    case "grace":
      return "Grace window";
    case "edit_locked":
      return "Edit lock";
    case "cooldown":
      return "Cooldown";
    case "archived":
      return "Archive";
    case "deleted":
      return "Removed object";
    case "public":
      return "Avatar profile";
    case "draft":
      return "Draft";
    case undefined:
      return "No object";
    default:
      state satisfies never;
      return "Object";
  }
}

function unavailableActionTitle(snapshot: GenerationSnapshot) {
  const object = snapshot.object;
  if (!object) return "No object selected";

  switch (object.state) {
    case "grace":
      return "Waiting for creator release";
    case "edit_locked":
      return "Locked by another editor";
    case "cooldown":
      return `v${object.version} cooling down`;
    case "archived":
      return `v${object.version} archived`;
    case "deleted":
      return "Object removed";
    case "public":
      return `v${object.version} published`;
    case "draft":
      return "Draft pending";
    default:
      object.state satisfies never;
      return "Unavailable";
  }
}

function resolveStageState(snapshot: GenerationSnapshot) {
  if (snapshot.stage === "failed") return "error";
  if (isBusy(snapshot)) return "busy";
  if (snapshot.stage === "released") return "ready";
  return "idle";
}

function resolveWorkflowState(snapshot: GenerationSnapshot): HudWorkflowState {
  switch (snapshot.stage) {
    case "idle":
      return "idle";
    case "queued":
      return "queued";
    case "planning":
    case "voxel_source_ready":
    case "compiled_artifact_ready":
      return "generating";
    case "grace":
      return "grace";
    case "edit_locked":
    case "cooldown":
      return "refining";
    case "released":
      return "released";
    case "failed":
      return "failed";
    default:
      snapshot.stage satisfies never;
      return "failed";
  }
}

function resolveWorkflowPillState(workflowState: HudWorkflowState) {
  switch (workflowState) {
    case "released":
      return "ready";
    case "queued":
    case "generating":
    case "grace":
    case "refining":
      return "busy";
    case "failed":
      return "error";
    case "idle":
      return "idle";
    default:
      workflowState satisfies never;
      return "idle";
  }
}

function resolveMultiplayerMode(
  backendPresence: BackendPresenceSnapshot | null,
): HudMultiplayerMode {
  if (!backendPresence?.enabled) return "local";

  switch (backendPresence.status) {
    case "connected":
      return "live";
    case "connecting":
      return "connecting";
    case "disconnected":
      return "offline";
    case "error":
      return "error";
    case "disabled":
      return "local";
    default:
      backendPresence.status satisfies never;
      return "error";
  }
}

function companionStateLabel(workflowState: HudWorkflowState) {
  switch (workflowState) {
    case "idle":
      return "ready";
    case "queued":
      return "queued";
    case "generating":
      return "working";
    case "grace":
      return "draft";
    case "refining":
      return "refining";
    case "released":
      return "synced";
    case "failed":
      return "blocked";
    default:
      workflowState satisfies never;
      return "ready";
  }
}

function syncLabel(
  snapshot: GenerationSnapshot,
  backendPresence: BackendPresenceSnapshot | null,
) {
  if (backendPresence?.enabled) {
    if (backendPresence.status === "connected") return "Backend live";
    if (backendPresence.status === "connecting") return "Connecting";
    if (backendPresence.status === "disconnected") return "Disconnected";
    return "Backend error";
  }

  if (snapshot.stage === "failed") return "Action needed";
  if (isBusy(snapshot)) return "Turn in progress";
  return snapshot.object ? "Scene synced" : "Local room";
}

function syncState(
  snapshot: GenerationSnapshot,
  backendPresence: BackendPresenceSnapshot | null,
) {
  if (backendPresence?.status === "connected") return "ready";
  if (
    backendPresence?.status === "connecting" ||
    backendPresence?.status === "disconnected"
  ) {
    return "busy";
  }
  if (backendPresence?.status === "error") return "error";
  return resolveStageState(snapshot);
}

function presenceLabel(backendPresence: BackendPresenceSnapshot | null) {
  if (!backendPresence?.enabled) return "Local room";
  if (backendPresence.status === "connected") {
    return `${backendPresence.onlineCount} online`;
  }
  if (backendPresence.status === "connecting") return "Joining";
  if (backendPresence.status === "disconnected") return "Offline";
  return "Offline";
}

function presenceState(backendPresence: BackendPresenceSnapshot | null) {
  if (backendPresence?.status === "connected") return "ready";
  if (
    backendPresence?.status === "connecting" ||
    backendPresence?.status === "disconnected"
  ) {
    return "busy";
  }
  if (backendPresence?.status === "error") return "error";
  return "idle";
}

function backendStatusLabel(backendPresence: BackendPresenceSnapshot | null) {
  if (!backendPresence?.enabled) return "local";
  return backendPresence.status;
}

function isBusy(snapshot: GenerationSnapshot) {
  return (
    snapshot.stage === "queued" ||
    snapshot.stage === "planning" ||
    snapshot.stage === "voxel_source_ready" ||
    snapshot.stage === "compiled_artifact_ready" ||
    snapshot.stage === "cooldown"
  );
}

function required<TElement extends HTMLElement>(
  root: HTMLElement,
  selector: string,
) {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Failed to create multiplayer HUD layout: ${selector}`);
  }

  return element;
}

function prettyJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "No data yet.";
}

function backendArtifactForSnapshot(
  snapshot: GenerationSnapshot,
  backendPresence: BackendPresenceSnapshot | null,
) {
  const objectId = snapshot.object?.object_id;
  if (!objectId || !backendPresence?.enabled) return null;

  return (
    backendPresence.objectArtifacts.find((artifact) => artifact.objectId === objectId) ??
    null
  );
}

function renderBackendArtifactDebug(
  artifact: NonNullable<ReturnType<typeof backendArtifactForSnapshot>>,
) {
  return `
    <div class="metric-grid">
      ${metric("Source", sourceSpecSummary(artifact.sourceSpecJson))}
      ${metric("Runtime", builderSpecSummary(artifact.builderSpecJson))}
    </div>
    <details class="json-card">
      <summary>Canonical source spec JSON</summary>
      <pre>${escapeHtml(prettyJsonText(artifact.sourceSpecJson))}</pre>
    </details>
    <details class="json-card">
      <summary>Derived renderer artifact JSON</summary>
      <pre>${escapeHtml(prettyJsonText(artifact.builderSpecJson))}</pre>
    </details>
  `;
}

function sourceSpecSummary(sourceSpecJson: string) {
  const parsed = parseJsonRecord(sourceSpecJson);
  if (!parsed) return "invalid source";

  const operations = Array.isArray(parsed.operations) ? parsed.operations.length : 0;
  return `${stringField(parsed, "object_category")} / ${operations} ops`;
}

function builderSpecSummary(builderSpecJson: string) {
  const parsed = parseJsonRecord(builderSpecJson);
  if (!parsed) return "invalid artifact";

  const complexity = parseRecord(parsed.complexity);
  const parts = numberField(complexity, "part_count");
  const instances = numberField(complexity, "instance_count");
  return `${stringField(parsed, "object_category")} / ${parts} parts / ${instances} instances`;
}

function prettyJsonText(jsonText: string) {
  try {
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch {
    return jsonText;
  }
}

function parseJsonRecord(jsonText: string) {
  try {
    return parseRecord(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  return typeof fieldValue === "string" && fieldValue ? fieldValue : "unknown";
}

function numberField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  return typeof fieldValue === "number" && Number.isFinite(fieldValue)
    ? String(fieldValue)
    : "0";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
