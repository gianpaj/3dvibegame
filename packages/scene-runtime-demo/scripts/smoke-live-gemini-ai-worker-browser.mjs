#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

loadRepoDotenv();

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.log("live Gemini AI worker browser smoke skipped: GOOGLE_GENERATIVE_AI_API_KEY is not set");
  process.exit(0);
}

const promptText = "Create a small glowing pine tree beside a shared voxel path.";
const workerPort = await findOpenPort();
const workerUrl = `http://127.0.0.1:${workerPort}`;
const worker = startGeminiAiWorker(workerPort);

try {
  await waitForHttp(
    `${workerUrl}/healthz`,
    "Gemini AI worker",
    15_000,
    () => worker.smokeOutput?.() ?? "",
  );

  await runLiveDemoBrowserSmoke({
    dbPrefix: "vibe-world-live-gemini-ai-worker-browser",
    nickname: "Gemini Worker Browser",
    viteEnv: {
      VITE_AI_CLIENT_MODE: "http-worker",
      VITE_AI_WORKER_TIMEOUT_MS: process.env.VITE_AI_WORKER_TIMEOUT_MS ?? "45000",
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
        "Gemini AI worker prompt reaches grace",
        60_000,
      );

      await page.click('button[data-object-lifecycle-action="release_object"]', "Release");
      await page.waitForExpression(
        `(() => {
          const stage = document.querySelector('[data-role="stage-pill"]');
          const room = document.querySelector('[data-role="room-subtitle"]');
          const fixedActionSelectors = [
            'button[data-object-lifecycle-action="refine_silhouette"]',
            'button[data-object-lifecycle-action="add_ornament"]',
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
        "Gemini AI worker draft releases publicly without fixed demo actions",
        20_000,
      );

      page.assertNoBrowserErrors();

      const objectRows = harness.query(
        "SELECT object_id, category, state, version FROM world_object",
      );
      expectIncludes(objectRows, '"public"', "Gemini AI worker object should release to public");
      expectIncludes(objectRows, " 1 ", "Gemini AI worker release should keep version 1");
      const category = firstSqlQuotedValue(objectRows, "category");
      if (!category) {
        throw new Error(`Gemini AI worker should create an object category\nOutput:\n${objectRows}`);
      }

      const jobRows = harness.query("SELECT job_type, status FROM ai_job");
      expectIncludes(jobRows, '"create"', "Gemini AI worker flow should request a create job");
      expectIncludes(jobRows, '"completed"', "Gemini AI worker create job should complete");

      console.log("live Gemini AI worker browser smoke passed");
      console.log(`database: ${harness.database}`);
      console.log(`ai_worker_url: ${workerUrl}/generate`);
      console.log(`object_category: ${category}`);
      console.log(`prompt_to_draft_ms: ${draftResult.promptToDraftMs}`);
    },
  });
} finally {
  await stopProcess(worker);
}

function startGeminiAiWorker(port) {
  const child = spawn("pnpm", ["--filter", "@3dvibegame/ai-worker", "start"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AI_WORKER_ALLOWED_ORIGIN: "*",
      AI_WORKER_HOST: "127.0.0.1",
      AI_WORKER_PORT: String(port),
      AI_WORKER_TIMEOUT_MS: process.env.AI_WORKER_TIMEOUT_MS ?? "45000",
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
