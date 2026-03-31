import type { LifecycleActionId, LifecycleSnapshot } from "../runtime/lifecycle";
import type { ScenarioKey } from "../runtime/scenarios";

interface ScenarioOption {
  key: ScenarioKey;
  label: string;
  description: string;
}

interface HudConfig {
  root: HTMLElement;
  scenarios: ScenarioOption[];
  onScenarioChange(key: ScenarioKey): void;
  onAction(actionId: LifecycleActionId): void;
}

const actionLabels: Record<LifecycleActionId, string> = {
  queue_create: "Queue create request",
  submit_ai_draft: "Submit AI draft",
  nudge_draft: "Nudge draft",
  scale_draft: "Scale draft",
  release_object: "Release object",
  expire_grace: "Expire grace",
  request_edit_lock: "Player 2 lock",
  submit_object_edit: "Submit edit",
  cancel_edit: "Cancel edit",
  expire_edit_lock: "Expire lock",
  expire_cooldown: "Expire cooldown",
};

export function createHud({
  root,
  scenarios,
  onScenarioChange,
  onAction,
}: HudConfig) {
  root.innerHTML = `
    <div class="hud__panel">
      <div class="eyebrow">Authoritative Lifecycle Prototype</div>
      <h1>Builder spec to live object state</h1>
      <p class="lede">
        Fixture-backed authority simulation for the Vibe World object lifecycle.
        This slice compiles voxel-native source fixtures into
        <code>BuilderSpec</code> runtime output, then renders authoritative
        object state from that compiled artifact.
      </p>

      <label class="field">
        <span>Scenario</span>
        <select data-role="scenario-select">
          ${scenarios
            .map(
              (scenario) =>
                `<option value="${scenario.key}">${scenario.label}</option>`,
            )
            .join("")}
        </select>
      </label>

      <div class="fixture-note" data-role="scenario-description"></div>
      <div class="stats" data-role="stats"></div>
      <section class="stage-card">
        <h2>Prompt</h2>
        <p data-role="source-prompt"></p>
      </section>

      <section class="stage-card">
        <h2>Available actions</h2>
        <div class="action-grid" data-role="actions"></div>
      </section>

      <section class="diagnostic-card" data-role="events"></section>

      <details class="json-card">
        <summary>Authority object JSON</summary>
        <pre data-role="object-json"></pre>
      </details>

      <details class="json-card">
        <summary>Builder spec JSON</summary>
        <pre data-role="builder-json"></pre>
      </details>

      <details class="json-card">
        <summary>World JSON</summary>
        <pre data-role="world-json"></pre>
      </details>
    </div>

    <div class="hud__chip hud__chip--objective">
      Goal: prove grace, public, edit lock, and cooldown against authoritative state.
    </div>

    <div class="hud__chip hud__chip--hint">
      Drag to orbit. The creator is <code>player_1</code>. The rival editor is <code>player_2</code>.
    </div>

    <div class="hud__status" data-role="context-message"></div>
  `;

  const scenarioSelect = root.querySelector<HTMLSelectElement>(
    '[data-role="scenario-select"]',
  );
  const scenarioDescription = root.querySelector<HTMLElement>(
    '[data-role="scenario-description"]',
  );
  const stats = root.querySelector<HTMLElement>('[data-role="stats"]');
  const sourcePrompt = root.querySelector<HTMLElement>('[data-role="source-prompt"]');
  const actions = root.querySelector<HTMLElement>('[data-role="actions"]');
  const events = root.querySelector<HTMLElement>('[data-role="events"]');
  const objectJson = root.querySelector<HTMLElement>('[data-role="object-json"]');
  const builderJson = root.querySelector<HTMLElement>('[data-role="builder-json"]');
  const worldJson = root.querySelector<HTMLElement>('[data-role="world-json"]');
  const contextMessage = root.querySelector<HTMLElement>(
    '[data-role="context-message"]',
  );

  if (
    !scenarioSelect ||
    !scenarioDescription ||
    !stats ||
    !sourcePrompt ||
    !actions ||
    !events ||
    !objectJson ||
    !builderJson ||
    !worldJson ||
    !contextMessage
  ) {
    throw new Error("Failed to create lifecycle HUD layout");
  }

  scenarioSelect.addEventListener("change", (event) => {
    onScenarioChange((event.target as HTMLSelectElement).value as ScenarioKey);
  });

  return {
    setSnapshot(snapshot: LifecycleSnapshot) {
      scenarioSelect.value = snapshot.scenarioKey;
      scenarioDescription.textContent = snapshot.description;
      sourcePrompt.textContent = snapshot.sourcePrompt;

      const object = snapshot.object;
      stats.innerHTML = [
        statCard("Jobs", String(snapshot.world.jobs.length)),
        statCard("Objects", String(snapshot.world.objects.length)),
        statCard("State", object?.state ?? "none"),
        statCard("Version", object ? String(object.version) : "0"),
        statCard("Grace owner", object?.grace_owner_id ?? "none"),
        statCard("Lock owner", object?.lock_owner_id ?? "none"),
      ].join("");

      actions.innerHTML = snapshot.availableActions
        .map(
          (actionId) =>
            `<button type="button" data-action="${actionId}">${actionLabels[actionId]}</button>`,
        )
        .join("");

      Array.from(actions.querySelectorAll<HTMLButtonElement>("button")).forEach(
        (button) => {
          button.addEventListener("click", () => {
            onAction(button.dataset.action as LifecycleActionId);
          });
        },
      );

      events.innerHTML = `
        <h2>Authority events</h2>
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

      objectJson.textContent = prettyJson(snapshot.object);
      builderJson.textContent = prettyJson(snapshot.object?.builder_spec ?? null);
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
  return value ? JSON.stringify(value, null, 2) : "No object exists yet.";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
