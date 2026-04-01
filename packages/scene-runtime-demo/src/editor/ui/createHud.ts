import type { GenerationActionId, GenerationSnapshot } from "../../core";
import type { ScenarioKey } from "../../core";

interface ScenarioOption {
  key: ScenarioKey;
  label: string;
  description: string;
  sourcePrompt: string;
}

interface HudConfig {
  root: HTMLElement;
  scenarios: ScenarioOption[];
  onPromptSubmit(prompt: string): void;
  onAction(actionId: GenerationActionId): void;
  onObjectSelect(objectId: string): void;
}

const actionLabels: Record<GenerationActionId, string> = {
  nudge_draft: "Move",
  rotate_draft: "Rotate",
  scale_draft: "Scale",
  release_object: "Release object",
};

const stageLabels = {
  idle: "Idle",
  queued: "Queued",
  planning: "Planning",
  voxel_source_ready: "Voxel source ready",
  compiled_artifact_ready: "Compiled artifact ready",
  grace: "Grace",
  edit_locked: "Edit locked",
  released: "Released",
  failed: "Failed",
} as const;

export function createHud({
  root,
  scenarios,
  onPromptSubmit,
  onAction,
  onObjectSelect,
}: HudConfig) {
  const initialPrompt = scenarios[0]?.sourcePrompt ?? "";

  root.innerHTML = `
    <div class="hud__panel">
      <div class="eyebrow">Validation-First Vertical Slice</div>
      <h1>Text to voxel source to released object</h1>
      <p class="lede">
        Fixture-backed single-player prototype for the real object loop.
        Submit a prompt, inspect staged generation, adjust the draft during grace,
        then release it into the world.
      </p>

      <form class="prompt-form" data-role="prompt-form">
        <label class="field">
          <span>Prompt</span>
          <textarea
            rows="3"
            data-role="prompt-input"
            placeholder="Add a pine tree to the left of the cabin."
          ></textarea>
        </label>
        <button class="primary-button" type="submit">Generate draft</button>
      </form>

      <section class="stage-card">
        <h2>Prompt recipes</h2>
        <div class="prompt-chip-grid" data-role="prompt-recipes"></div>
        <p class="fixture-note" data-role="scenario-description"></p>
      </section>

      <div class="stats" data-role="stats"></div>

      <section class="stage-card">
        <h2>Stage timeline</h2>
        <ol class="stage-list" data-role="stage-events"></ol>
      </section>

      <section class="stage-card">
        <h2>World objects</h2>
        <div class="object-list" data-role="object-list"></div>
      </section>

      <section class="stage-card">
        <h2>Structured intent</h2>
        <p data-role="intent-summary"></p>
      </section>

      <section class="stage-card">
        <h2>Canonical voxel source</h2>
        <p data-role="voxel-summary"></p>
      </section>

      <section class="stage-card">
        <h2>Compiled runtime artifact</h2>
        <p data-role="artifact-summary"></p>
      </section>

      <section class="diagnostic-card" data-role="events"></section>

      <details class="json-card">
        <summary>Structured intent JSON</summary>
        <pre data-role="intent-json"></pre>
      </details>

      <details class="json-card">
        <summary>Voxel source JSON</summary>
        <pre data-role="voxel-json"></pre>
      </details>

      <details class="json-card">
        <summary>Builder artifact JSON</summary>
        <pre data-role="builder-json"></pre>
      </details>

      <details class="json-card">
        <summary>Authority world JSON</summary>
        <pre data-role="world-json"></pre>
      </details>
    </div>

    <div class="hud__chip hud__chip--objective">
      Goal: validate a prompt-driven grace-period loop before multiplayer.
    </div>

    <section class="hud__dock" data-role="action-dock">
      <div class="hud__dock-card">
        <div class="hud__dock-header">
          <span>Creator Actions</span>
          <small>Current draft controls</small>
        </div>
        <div class="action-grid" data-role="actions"></div>
      </div>
    </section>

    <div class="hud__chip hud__chip--hint">
      This prototype is deterministic and fixture-backed. Prompt text selects the closest recipe path.
    </div>

    <div class="hud__status" data-role="context-message"></div>
  `;

  const form = root.querySelector<HTMLFormElement>('[data-role="prompt-form"]');
  const promptInput = root.querySelector<HTMLTextAreaElement>('[data-role="prompt-input"]');
  const recipeGrid = root.querySelector<HTMLElement>('[data-role="prompt-recipes"]');
  const scenarioDescription = root.querySelector<HTMLElement>(
    '[data-role="scenario-description"]',
  );
  const stats = root.querySelector<HTMLElement>('[data-role="stats"]');
  const stageEvents = root.querySelector<HTMLElement>('[data-role="stage-events"]');
  const objectList = root.querySelector<HTMLElement>('[data-role="object-list"]');
  const intentSummary = root.querySelector<HTMLElement>('[data-role="intent-summary"]');
  const voxelSummary = root.querySelector<HTMLElement>('[data-role="voxel-summary"]');
  const artifactSummary = root.querySelector<HTMLElement>('[data-role="artifact-summary"]');
  const actions = root.querySelector<HTMLElement>('[data-role="actions"]');
  const events = root.querySelector<HTMLElement>('[data-role="events"]');
  const intentJson = root.querySelector<HTMLElement>('[data-role="intent-json"]');
  const voxelJson = root.querySelector<HTMLElement>('[data-role="voxel-json"]');
  const builderJson = root.querySelector<HTMLElement>('[data-role="builder-json"]');
  const worldJson = root.querySelector<HTMLElement>('[data-role="world-json"]');
  const contextMessage = root.querySelector<HTMLElement>(
    '[data-role="context-message"]',
  );

  if (
    !form ||
    !promptInput ||
    !recipeGrid ||
    !scenarioDescription ||
    !stats ||
    !stageEvents ||
    !objectList ||
    !intentSummary ||
    !voxelSummary ||
    !artifactSummary ||
    !actions ||
    !events ||
    !intentJson ||
    !voxelJson ||
    !builderJson ||
    !worldJson ||
    !contextMessage
  ) {
    throw new Error("Failed to create validation-first HUD layout");
  }

  promptInput.value = initialPrompt;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onPromptSubmit(promptInput.value);
  });

  recipeGrid.innerHTML = scenarios
    .map(
      (scenario) => `
        <button
          class="prompt-chip"
          type="button"
          data-prompt="${escapeHtml(scenario.sourcePrompt)}"
        >
          ${escapeHtml(scenario.label)}
        </button>
      `,
    )
    .join("");

  Array.from(recipeGrid.querySelectorAll<HTMLButtonElement>("button")).forEach(
    (button) => {
      button.addEventListener("click", () => {
        promptInput.value = button.dataset.prompt ?? "";
      });
    },
  );

  return {
    setSnapshot(snapshot: GenerationSnapshot) {
      if (document.activeElement !== promptInput) {
        promptInput.value = snapshot.sourcePrompt;
      }

      scenarioDescription.textContent = `${snapshot.matchedScenarioLabel}: ${snapshot.matchedScenarioDescription}`;

      stats.innerHTML = [
        statCard("Stage", stageLabels[snapshot.stage]),
        statCard("World state", snapshot.object?.state ?? "none"),
        statCard("Matched recipe", snapshot.matchedScenarioLabel),
        statCard("Objects", String(snapshot.world.objects.length)),
        statCard(
          "Parts",
          snapshot.compiledArtifact
            ? String(snapshot.compiledArtifact.payload.complexity.part_count)
            : "0",
        ),
        statCard("Version", snapshot.object ? String(snapshot.object.version) : "0"),
      ].join("");

      stageEvents.innerHTML = snapshot.stageEvents.length
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
        : `<li class="stage-event" data-status="pending" data-stage="idle"><div class="stage-event__meta"><strong>Idle</strong><time>--:--:--</time></div><span>Submit a prompt to start the staged flow.</span></li>`;

      objectList.innerHTML = snapshot.world.objects.length
        ? snapshot.world.objects
            .map(
              (object) => `
                <button
                  type="button"
                  class="object-chip${snapshot.object?.object_id === object.object_id ? " is-active" : ""}"
                  data-object-id="${escapeHtml(object.object_id)}"
                >
                  <strong>${escapeHtml(object.builder_spec.object_category)}</strong>
                  <span>${escapeHtml(object.state)} • v${escapeHtml(String(object.version))}</span>
                </button>
              `,
            )
            .join("")
        : `<p class="empty-actions">No objects in the world yet.</p>`;

      Array.from(objectList.querySelectorAll<HTMLButtonElement>("button")).forEach(
        (button) => {
          button.addEventListener("click", () => {
            const objectId = button.dataset.objectId;
            if (!objectId) return;
            onObjectSelect(objectId);
          });
        },
      );

      intentSummary.textContent = snapshot.plannedIntent
        ? `${snapshot.plannedIntent.object_category} • ${snapshot.plannedIntent.size_tier} • ${snapshot.plannedIntent.placement.mode} placement`
        : "No structured intent yet.";

      voxelSummary.textContent = snapshot.voxelArtifact
        ? snapshot.voxelArtifact.summary
        : "Waiting for voxel-native source.";

      artifactSummary.textContent = snapshot.compiledArtifact
        ? snapshot.compiledArtifact.summary
        : "Waiting for compiled runtime artifact.";

      actions.innerHTML = snapshot.availableActions.length
        ? snapshot.availableActions
            .map(
              (actionId) =>
                `<button type="button" data-action="${actionId}">${actionLabels[actionId]}</button>`,
            )
            .join("")
        : `<p class="empty-actions">Creator actions unlock once the authoritative draft enters grace.</p>`;

      Array.from(actions.querySelectorAll<HTMLButtonElement>("button")).forEach(
        (button) => {
          button.addEventListener("click", () => {
            onAction(button.dataset.action as GenerationActionId);
          });
        },
      );

      events.innerHTML = `
        <h2>Session diagnostics</h2>
        <p class="diagnostic-lede">${escapeHtml(snapshot.lastMessage)}</p>
        ${
          snapshot.world.events.length
            ? `<ul>${snapshot.world.events
                .map(
                  (event) =>
                    `<li>${escapeHtml(
                      `${event.kind}: ${event.message}`,
                    )}</li>`,
                )
                .join("")}</ul>`
            : "<p>No authority events yet.</p>"
        }
      `;

      intentJson.textContent = prettyJson(snapshot.plannedIntent);
      voxelJson.textContent = prettyJson(snapshot.voxelArtifact?.payload ?? null);
      builderJson.textContent = prettyJson(snapshot.compiledArtifact?.payload ?? null);
      worldJson.textContent = prettyJson(snapshot.world);
    },
    setContextMessage(message: string) {
      contextMessage.textContent = message;
      contextMessage.dataset.state = message ? "visible" : "hidden";
    },
  };
}

function statCard(label: string, value: string) {
  return `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function prettyJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "No data yet.";
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
