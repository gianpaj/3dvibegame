import type { PipelineSnapshot } from "../runtime/pipeline";
import type { FixtureKey } from "../runtime/fixtures";

interface FixtureOption {
  key: FixtureKey;
  label: string;
  description: string;
}

interface HudConfig {
  root: HTMLElement;
  fixtures: FixtureOption[];
  onFixtureChange(key: FixtureKey): void;
}

export function createHud({ root, fixtures, onFixtureChange }: HudConfig) {
  root.innerHTML = `
    <div class="hud__panel">
      <div class="eyebrow">Scene Runtime Three Prototype</div>
      <h1>Normalized plan to renderer</h1>
      <p class="lede">
        Plain Three.js consumer for the Vibe World rough-draft pipeline. The
        viewport renders saved artifacts through the normalized scene plan and
        render-draft contracts.
      </p>

      <label class="field">
        <span>Fixture</span>
        <select data-role="fixture-select">
          ${fixtures
            .map(
              (fixture) =>
                `<option value="${fixture.key}">${fixture.label}</option>`,
            )
            .join("")}
        </select>
      </label>

      <div class="fixture-note" data-role="fixture-description"></div>
      <div class="stats" data-role="stats"></div>
      <div class="pipeline" data-role="pipeline"></div>
      <div class="diagnostics" data-role="diagnostics"></div>

      <details class="json-card">
        <summary>Parsed response</summary>
        <pre data-role="parsed-json"></pre>
      </details>

      <details class="json-card">
        <summary>Normalized plan</summary>
        <pre data-role="normalized-json"></pre>
      </details>

      <details class="json-card">
        <summary>Render drafts</summary>
        <pre data-role="drafts-json"></pre>
      </details>
    </div>

    <div class="hud__chip hud__chip--objective">
      Goal: prove the renderer can consume normalized plans and rough drafts.
    </div>

    <div class="hud__chip hud__chip--hint">
      Drag to orbit. Scroll to zoom. Static anchors: cabin_1, campfire_1, lake_1.
    </div>

    <div class="hud__status" data-role="context-message"></div>
  `;

  const fixtureSelect = root.querySelector<HTMLSelectElement>(
    '[data-role="fixture-select"]',
  );
  const fixtureDescription = root.querySelector<HTMLElement>(
    '[data-role="fixture-description"]',
  );
  const stats = root.querySelector<HTMLElement>('[data-role="stats"]');
  const pipeline = root.querySelector<HTMLElement>('[data-role="pipeline"]');
  const diagnostics = root.querySelector<HTMLElement>('[data-role="diagnostics"]');
  const parsedJson = root.querySelector<HTMLElement>('[data-role="parsed-json"]');
  const normalizedJson = root.querySelector<HTMLElement>(
    '[data-role="normalized-json"]',
  );
  const draftsJson = root.querySelector<HTMLElement>('[data-role="drafts-json"]');
  const contextMessage = root.querySelector<HTMLElement>(
    '[data-role="context-message"]',
  );

  if (
    !fixtureSelect ||
    !fixtureDescription ||
    !stats ||
    !pipeline ||
    !diagnostics ||
    !parsedJson ||
    !normalizedJson ||
    !draftsJson ||
    !contextMessage
  ) {
    throw new Error("Failed to create HUD layout");
  }

  fixtureSelect.addEventListener("change", (event) => {
    onFixtureChange((event.target as HTMLSelectElement).value as FixtureKey);
  });

  return {
    setSnapshot(snapshot: PipelineSnapshot) {
      fixtureSelect.value = snapshot.fixtureKey;
      fixtureDescription.textContent = snapshot.fixtureDescription;

      stats.innerHTML = [
        statCard("Response type", snapshot.summary.responseType),
        statCard("Plan kind", snapshot.normalizedPlan?.plan_kind ?? "none"),
        statCard("Drafts", String(snapshot.renderDrafts.length)),
        statCard("Nodes", String(snapshot.summary.renderDraftNodeCount)),
      ].join("");

      pipeline.innerHTML = [
        stageCard("Artifact", [
          `sample: ${snapshot.summary.sampleId}`,
          `task: ${snapshot.summary.taskId}`,
        ]),
        stageCard("Parsed response", [
          `status: ${snapshot.parsedResponse ? "available" : "missing"}`,
          `type: ${snapshot.parsedResponse?.response_type ?? "none"}`,
          `actions: ${snapshot.parsedResponse?.actions?.length ?? 0}`,
        ]),
        stageCard("Normalized plan", [
          `source: ${snapshot.normalizedPlanSource}`,
          `kind: ${snapshot.normalizedPlan?.plan_kind ?? "none"}`,
          `intents: ${snapshot.normalizedPlan?.intents.length ?? 0}`,
        ]),
        stageCard("Render drafts", [
          `source: ${snapshot.renderDraftSource}`,
          `drafts: ${snapshot.renderDrafts.length}`,
          `warnings: ${snapshot.summary.totalWarnings}`,
        ]),
      ].join("");

      diagnostics.innerHTML = buildDiagnostics(snapshot);

      parsedJson.textContent = prettyJson(snapshot.parsedResponse);
      normalizedJson.textContent = prettyJson(snapshot.normalizedPlan);
      draftsJson.textContent = prettyJson(snapshot.renderDrafts);
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

function stageCard(title: string, lines: string[]) {
  return `
    <section class="stage-card">
      <h2>${escapeHtml(title)}</h2>
      ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </section>
  `;
}

function buildDiagnostics(snapshot: PipelineSnapshot) {
  const messages = [...snapshot.warnings];

  if (snapshot.normalizedPlan?.clarification) {
    messages.push(`clarification: ${snapshot.normalizedPlan.clarification.question}`);
  }

  if (snapshot.normalizedPlan?.refusal) {
    messages.push(`refusal: ${snapshot.normalizedPlan.refusal.reason}`);
  }

  if (messages.length === 0) {
    return `
      <section class="diagnostic-card">
        <h2>Diagnostics</h2>
        <p>No runtime warnings for this fixture.</p>
      </section>
    `;
  }

  return `
    <section class="diagnostic-card">
      <h2>Diagnostics</h2>
      <ul>
        ${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function prettyJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "No data for this stage.";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
