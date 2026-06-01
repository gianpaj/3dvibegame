#!/usr/bin/env node

import { spawn } from "node:child_process";

import {
  expectIncludes,
  repoRoot,
} from "../../world-backend/scripts/spacetime-smoke-harness.mjs";
import {
  findOpenPort,
  runLiveDemoBrowserSmoke,
  stopProcess,
  waitForHttp,
  waitForLiveBackendHud,
} from "./browser-smoke-harness.mjs";

const promptText = "Create a pine tree with a soft glow beside the path.";
const workerPort = await findOpenPort();
const workerUrl = `http://127.0.0.1:${workerPort}`;
const worker = startFakeAiWorker(workerPort);

try {
  await waitForHttp(
    `${workerUrl}/healthz`,
    "fake AI worker",
    15_000,
    () => worker.smokeOutput?.() ?? "",
  );

  await runLiveDemoBrowserSmoke({
    dbPrefix: "vibe-world-live-http-ai-worker-browser",
    nickname: "HTTP Worker Browser",
    viteEnv: {
      VITE_AI_WORKER_TIMEOUT_MS: "10000",
      VITE_AI_WORKER_URL: `${workerUrl}/generate`,
    },
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
          const release = document.querySelector('button[data-object-lifecycle-action="release_object"]');
          if (stage?.dataset.workflow !== "grace" || !(release instanceof HTMLButtonElement)) {
            return null;
          }
          return {
            promptToDraftMs: Math.round(performance.now() - ${promptStartedAt}),
            stageText: stage.textContent,
          };
        })()`,
        "HTTP AI worker prompt reaches grace",
        20_000,
      );

      await page.click('button[data-object-lifecycle-action="release_object"]', "Release");
      await page.waitForExpression(
        `(() => {
          const stage = document.querySelector('[data-role="stage-pill"]');
          const room = document.querySelector('[data-role="room-subtitle"]');
          const fixedActionSelectors = [
            'button[data-object-lifecycle-action="refine_silhouette"]',
            'button[data-object-lifecycle-action="add_ornament"]',
            'button[data-object-lifecycle-action="nudge_draft"]',
            'button[data-object-lifecycle-action="rotate_draft"]',
            'button[data-object-lifecycle-action="scale_draft"]',
            'button[data-refine]',
            'button[data-prompt]',
          ];
          const hasFixedAction = fixedActionSelectors.some((selector) =>
            document.querySelector(selector),
          );
          return stage?.dataset.workflow === "released" &&
            room?.textContent?.includes("1 object") &&
            !hasFixedAction;
        })()`,
        "HTTP AI worker draft releases publicly without fixed demo actions",
        20_000,
      );

      page.assertNoBrowserErrors();

      const objectRows = harness.query(
        "SELECT object_id, category, state, version FROM world_object",
      );
      expectIncludes(objectRows, '"pine_tree"', "HTTP AI worker should create fake pine tree category");
      expectIncludes(objectRows, '"public"', "HTTP AI worker object should release to public");
      expectIncludes(objectRows, " 1 ", "HTTP AI worker release should keep version 1");
      const jobRows = harness.query("SELECT job_type, status FROM ai_job");
      expectIncludes(jobRows, '"create"', "HTTP AI worker flow should request a create job");
      expectIncludes(jobRows, '"completed"', "HTTP AI worker create job should complete");

      console.log("live HTTP AI worker browser smoke passed");
      console.log(`database: ${harness.database}`);
      console.log(`ai_worker_url: ${workerUrl}/generate`);
      console.log(`prompt_to_draft_ms: ${draftResult.promptToDraftMs}`);
    },
  });
} finally {
  await stopProcess(worker);
}

function startFakeAiWorker(port) {
  const child = spawn("pnpm", ["--filter", "@3dvibegame/ai-worker", "start"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AI_WORKER_ALLOWED_ORIGIN: "*",
      AI_WORKER_FAKE: "1",
      AI_WORKER_HOST: "127.0.0.1",
      AI_WORKER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  attachProcessLog(child, "ai-worker");
  return child;
}

function attachProcessLog(child, label) {
  let output = "";
  child.smokeOutput = () => output.slice(-4_000);
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== 143 && signal !== "SIGTERM") {
      process.stderr.write(`${label} exited with ${code ?? signal}\n${output}\n`);
    }
  });
}
