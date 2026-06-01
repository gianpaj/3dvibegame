#!/usr/bin/env node

import { expectIncludes } from "../../world-backend/scripts/spacetime-smoke-harness.mjs";
import {
  runLiveDemoBrowserSmoke,
  waitForLiveBackendHud,
} from "./browser-smoke-harness.mjs";

const promptText =
  "Create a mossy forest guardian avatar with broad shoulders and a glowing chest rune.";

await runLiveDemoBrowserSmoke({
  dbPrefix: "vibe-world-live-first-playable-browser",
  async run({ harness, page }) {
    await waitForLiveBackendHud(page);

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
        const release = document.querySelector('button[data-refine="release_object"]');
        if (stage?.dataset.workflow !== "grace" || !(release instanceof HTMLButtonElement)) {
          return null;
        }
        return {
          promptToDraftMs: Math.round(performance.now() - ${promptStartedAt}),
          stageText: stage.textContent,
        };
      })()`,
      "prompt reaches grace with release action",
      20_000,
    );

    await page.click('button[data-refine="release_object"]', "Release");
    await page.waitForExpression(
      `(() => {
        const stage = document.querySelector('[data-role="stage-pill"]');
        const refine = document.querySelector('button[data-refine="refine_silhouette"]');
        const room = document.querySelector('[data-role="room-subtitle"]');
        return stage?.dataset.workflow === "released" &&
          refine instanceof HTMLButtonElement &&
          room?.textContent?.includes("1 object");
      })()`,
      "released public object with remix action",
      20_000,
    );

    await page.click('button[data-refine="refine_silhouette"]', "Refine silhouette");
    const finalUi = await page.waitForExpression(
      `(() => {
        const stage = document.querySelector('[data-role="stage-pill"]');
        const nextRefine = document.querySelector('button[data-refine="add_ornament"]');
        const actionDock = document.querySelector('[data-role="action-dock"]');
        const feedback = document.querySelector('[data-role="feedback-dock"]');
        if (stage?.dataset.workflow !== "released" || !(nextRefine instanceof HTMLButtonElement)) {
          return null;
        }
        return {
          actionText: actionDock?.textContent?.replace(/\\s+/g, " ").trim(),
          feedbackText: feedback?.textContent?.replace(/\\s+/g, " ").trim(),
          workflow: stage.dataset.workflow,
        };
      })()`,
      "public remix returns to released v2",
      20_000,
    );

    page.assertNoBrowserErrors();

    const objectRows = harness.query("SELECT object_id, state, version FROM world_object");
    expectIncludes(objectRows, '"public"', "Browser flow should leave object public");
    expectIncludes(objectRows, " 2 ", "Browser remix should create version 2");
    const jobRows = harness.query("SELECT job_type, status FROM ai_job");
    expectIncludes(jobRows, '"create"', "Browser flow should request a create job");
    expectIncludes(jobRows, '"completed"', "Browser create job should complete");

    console.log("live first-playable browser smoke passed");
    console.log(`database: ${harness.database}`);
    console.log(`prompt_to_draft_ms: ${draftResult.promptToDraftMs}`);
    console.log(`final_action: ${finalUi.actionText}`);
  },
});
