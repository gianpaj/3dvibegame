import type {
  GenerationActionId,
  GenerationSnapshot,
} from "../runtime/generationSession";
import type { ScenarioKey } from "../runtime/scenarios";

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
}

const actionLabels: Record<GenerationActionId, string> = {
  nudge_draft: "Move draft",
  rotate_draft: "Rotate draft",
  scale_draft: "Scale draft",
  release_object: "Release object",
};

const stageLabels = {
  idle: "Idle",
  queued: "Queued",
  planning: "Planning",
  voxel_source_ready: "Voxel source ready",
  compiled_artifact_ready: "Compiled artifact ready",
  grace: "Grace",
  released: "Released",
  failed: "Failed",
} as const;

export function createHud({
  root,
  scenarios,
  onPromptSubmit,
  onAction,
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

      <section class="stage-card">
        <h2>Creator actions</h2>
        <div class="action-grid" data-role="actions"></div>
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
                <li class="stage-event" data-status="${event.status}">
                  <strong>${escapeHtml(stageLabels[event.stage])}</strong>
                  <span>${escapeHtml(event.message)}</span>
                </li>
              `,
            )
            .join("")
        : `<li class="stage-event" data-status="pending"><strong>Idle</strong><span>Submit a prompt to start the staged flow.</span></li>`;

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
