#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  expectIncludes,
  repoRoot,
} from "../../world-backend/scripts/spacetime-smoke-harness.mjs";
import {
  runLiveDemoBrowserSmoke,
  waitForLiveBackendHud,
} from "./browser-smoke-harness.mjs";

loadRepoDotenv();

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.log("live browser Gemini smoke skipped: GOOGLE_GENERATIVE_AI_API_KEY is not set");
  process.exit(0);
}

const promptText = "Create a small glowing pine tree beside a shared voxel path.";

await runLiveDemoBrowserSmoke({
  dbPrefix: "vibe-world-live-browser-gemini-browser",
  nickname: "Browser Gemini",
  async run({ harness, page }) {
    await waitForLiveBackendHud(page);

    await page.click('button[data-panel="settings"]', "Settings");
    await page.evaluate(
      `(() => {
        const form = document.querySelector('[data-role="ai-settings-form"]');
        const input = document.querySelector('input[name="geminiApiKey"]');
        if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
          throw new Error("AI settings controls not found");
        }
        input.value = ${JSON.stringify(process.env.GOOGLE_GENERATIVE_AI_API_KEY)};
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        form.requestSubmit();
        return true;
      })()`,
    );

    const keyConfigured = await page.waitForExpression(
      `(() => {
        const toast = document.querySelector('[data-role="context-message"]');
        const settings = document.querySelector('[data-role="side-panel"]');
        return toast?.textContent?.includes("Browser Gemini key configured") &&
          settings?.textContent?.includes("Gemini direct");
      })()`,
      "browser Gemini key configured",
      5_000,
    );
    if (!keyConfigured) {
      throw new Error("Browser Gemini key was not configured");
    }

    const promptStartedAt = await page.evaluate("performance.now()");
    await page.evaluate(
      `(() => {
        const input = document.querySelector('[data-role="prompt-input"]');
        const form = document.querySelector('[data-role="prompt-form"]');
        if (!(input instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) {
          throw new Error("prompt controls not found");
        }
        input.value = ${JSON.stringify(promptText)};
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        form.requestSubmit();
        return true;
      })()`,
    );

    const draftResult = await page.waitForExpression(
      `(() => {
        const stage = document.querySelector('[data-role="stage-pill"]');
        const release = document.querySelector('button[data-object-lifecycle-action="release_object"]');
        if (stage?.dataset.workflow !== "grace" || !(release instanceof HTMLButtonElement)) {
          return null;
        }
        return {
          promptToDraftMs: Math.round(performance.now() - ${promptStartedAt}),
          stageText: stage.textContent,
        };
      })()`,
      "browser Gemini prompt reaches grace",
      60_000,
    );

    await page.click('button[data-object-lifecycle-action="release_object"]', "Release");
    await page.waitForExpression(
      `(() => {
        const stage = document.querySelector('[data-role="stage-pill"]');
        const room = document.querySelector('[data-role="room-subtitle"]');
        return stage?.dataset.workflow === "released" &&
          room?.textContent?.includes("1 object");
      })()`,
      "browser Gemini draft releases publicly",
      20_000,
    );

    page.assertNoBrowserErrors();

    const objectRows = harness.query(
      "SELECT object_id, category, state, version FROM world_object",
    );
    expectIncludes(objectRows, '"public"', "Browser Gemini object should release to public");
    expectIncludes(objectRows, " 1 ", "Browser Gemini release should keep version 1");
    const category = firstSqlQuotedValue(objectRows, "category");
    if (!category) {
      throw new Error(`Browser Gemini should create an object category\nOutput:\n${objectRows}`);
    }

    const jobRows = harness.query("SELECT job_type, status FROM ai_job");
    expectIncludes(jobRows, '"create"', "Browser Gemini flow should request a create job");
    expectIncludes(jobRows, '"completed"', "Browser Gemini create job should complete");

    console.log("live browser Gemini browser smoke passed");
    console.log(`database: ${harness.database}`);
    console.log(`object_category: ${category}`);
    console.log(`prompt_to_draft_ms: ${draftResult.promptToDraftMs}`);
  },
});

function loadRepoDotenv() {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    process.env[match[1]] = unquoteEnvValue(match[2]);
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstSqlQuotedValue(output, columnName) {
  const headers = output
    .split("\n")[0]
    ?.split("|")
    .map((header) => header.trim());
  const columnIndex = headers?.indexOf(columnName) ?? -1;
  if (columnIndex < 0) {
    return null;
  }

  for (const line of output.split("\n").slice(2)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const value = cells[columnIndex];
    const match = value?.match(/^"(.+)"$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}
