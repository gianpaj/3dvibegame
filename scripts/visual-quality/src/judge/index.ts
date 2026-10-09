import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sha256 } from "../canonical.ts";
import {
  DIMENSIONS,
  JUDGMENT_FORMAT,
  type CaptureRecord,
  type JudgeAttempt,
  type JudgmentRecord,
  type Split,
  type ValidatedSample,
} from "../contracts.ts";
import { readJson, writeJson } from "../files.ts";
import { cacheRoot } from "../paths.ts";
import { redactSecrets, redactValue } from "../redact.ts";
import { judgmentPath, readCapture, readJudgments, readSamples, runDir, sampleDir } from "../run.ts";
import { Budget, type BudgetLimits } from "./budget.ts";
import type { ClientResult, DecisionsClient } from "./client.ts";
import {
  buildDecisionRequest,
  judgeCacheKey,
  redactImages,
  REQUEST_FORMAT,
  type JudgeConfig,
  type JudgeView,
} from "./request.ts";
import { validateDecisionResponse } from "./response.ts";
import { applicableQuestions, type LoadedRubric } from "./rubric.ts";

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = { model: "gpt-6-luna", image_detail: "auto" };

// Pricing for /v1/decisions with gpt-6-luna as documented on 2026-10-08:
// $0.10 per 1M input tokens, no output charge.
export const DEFAULT_USD_PER_INPUT_TOKEN = 0.1 / 1_000_000;

// HTTP statuses worth retrying. Everything else (bad request, auth, not found)
// fails immediately.
const TRANSIENT_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;

const judgmentCacheRoot = path.join(cacheRoot, "judgments");

export interface JudgeOptions {
  client: DecisionsClient;
  config: JudgeConfig;
  rubric: LoadedRubric;
  limits: BudgetLimits;
  concurrency: number;
  deadlineMs: number;
  maxRetries: number;
  reuse: boolean;
  trials: number;
  sampleIds?: string[];
  // Only samples in this split (e.g. development while tuning the rubric).
  split?: Split;
  // Pre-usage token estimate per image; the largest reported usage replaces
  // the estimate once responses arrive.
  estimatedTokensPerImage: number;
  // Secrets to scrub from anything saved or logged.
  secrets?: string[];
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface JudgeSummary {
  mock: boolean;
  tasks: number;
  completed: number;
  refused: number;
  incomplete: number;
  api_error: number;
  reused: number;
  resumed: number;
  not_judged: number;
  not_captured: number;
  requests: number;
  retries: number;
  input_tokens: number;
  estimated_cost_usd: number;
  unmeasured_requests: number;
  budget_exhausted: string | null;
}

interface Task {
  sample: ValidatedSample;
  capture: CaptureRecord;
  trial: number;
}

type TaskOutcome = JudgmentRecord["status"] | "reused" | "resumed" | "not_judged";

export async function judgeRun(runId: string, options: JudgeOptions): Promise<JudgeSummary> {
  const log = options.log ?? (() => {});
  // Limits guard paid calls; the free mock client must cover every sample.
  const budget = new Budget(
    options.client.mock ? { ...options.limits, maxRequests: Infinity, maxCostUsd: Infinity } : options.limits,
  );
  const summary: JudgeSummary = {
    mock: options.client.mock,
    tasks: 0,
    completed: 0,
    refused: 0,
    incomplete: 0,
    api_error: 0,
    reused: 0,
    resumed: 0,
    not_judged: 0,
    not_captured: 0,
    requests: 0,
    retries: 0,
    input_tokens: 0,
    estimated_cost_usd: 0,
    unmeasured_requests: 0,
    budget_exhausted: null,
  };

  const tasks: Task[] = [];
  for (const validation of readSamples(runId)) {
    if (validation.status !== "valid") continue;
    const { sample } = validation;
    if (options.sampleIds && !options.sampleIds.includes(sample.sample_id)) continue;
    if (options.split && sample.split !== options.split) continue;
    const capture = readCapture(runId, sample.sample_id);
    // A failed, missing or altered capture never triggers a paid call.
    if (capture?.status !== "captured" || !viewsIntact(runId, capture)) {
      summary.not_captured += 1;
      log(`not captured ${sample.sample_id}`);
      continue;
    }
    for (let trial = 0; trial < options.trials; trial += 1) tasks.push({ sample, capture, trial });
  }
  summary.tasks = tasks.length;

  if (
    !options.client.mock &&
    options.rubric.rubric.status !== "frozen" &&
    tasks.some((task) => task.sample.split === "holdout")
  ) {
    throw new Error(
      `rubric ${options.rubric.rubric.version} is still a draft; freeze it before judging holdout samples ` +
        "(or select development samples with --samples)",
    );
  }

  // Keep the exact rubric text with the run; judgments reference it by hash.
  const rubricDir = path.join(runDir(runId), "rubrics");
  mkdirSync(rubricDir, { recursive: true });
  writeFileSync(path.join(rubricDir, `${options.rubric.sha256}.json`), options.rubric.text);

  let observedMaxTokens = 0;
  const runTask = async (task: Task): Promise<TaskOutcome> => {
    const views = loadViews(runId, task.capture);
    const asked = applicableQuestions(options.rubric.rubric, task.sample.visual_attributes_applicable);
    const key = judgeCacheKey({
      config: options.config,
      rubricSha256: options.rubric.sha256,
      prompt: task.sample.prompt,
      views,
      questionNames: asked.map((q) => q.name),
      mock: options.client.mock,
    });

    const viewHashes = task.capture.views.map((v) => v.sha256);
    if (options.reuse) {
      const existing = readJudgments(runId, task.sample.sample_id).find((j) => j.trial === task.trial);
      if (existing?.status === "completed" && existing.cache_key === key && existing.view_sha256?.join() === viewHashes.join()) {
        return "resumed";
      }
      // Only the first trial reuses earlier results; later trials measure
      // repeatability and always call the judge.
      const cached = task.trial === 0 ? readCachedJudgment(key) : null;
      if (cached) {
        writeJson(judgmentPath(runId, task.sample.sample_id, task.trial), {
          ...cached,
          sample_id: task.sample.sample_id,
          trial: task.trial,
          // The reuse key covers image hashes, so these are the judged views.
          view_sha256: viewHashes,
          reused_from: cached.evaluated_at,
          attempts: [],
        } satisfies JudgmentRecord);
        return "reused";
      }
    }

    const request = buildDecisionRequest({
      config: options.config,
      preamble: options.rubric.rubric.preamble,
      prompt: task.sample.prompt,
      views,
      questions: asked,
    });
    const textChars = request.input[0]!.content.reduce((n, part) => n + (part.type === "input_text" ? part.text.length : 0), 0)
      + JSON.stringify(request.questions).length;
    const estimate = () =>
      Math.max(observedMaxTokens, Math.ceil(textChars / 4) + views.length * options.estimatedTokensPerImage);

    const attempts: JudgeAttempt[] = [];
    let costUsd = 0;
    let usageUnknown = false;
    let last: ClientResult | null = null;
    let finalError: string | null = null;
    const started = performance.now();

    let reservation = budget.reserve(estimate());
    if (!reservation) return "not_judged";
    for (;;) {
      const attemptStart = performance.now();
      const startedAt = new Date().toISOString();
      last = await options.client.send(request, options.deadlineMs);
      const durationMs = Math.round(performance.now() - attemptStart);

      if (last.kind === "network_error") {
        // Unknown whether the request was processed: charge the estimate.
        costUsd += budget.settle(reservation, null);
        usageUnknown = true;
        attempts.push({ started_at: startedAt, duration_ms: durationMs, http_status: null, error: last.error, transient: true });
      } else if (last.status === 200) {
        const usage = usageOf(last.body);
        if (usage !== null) observedMaxTokens = Math.max(observedMaxTokens, usage);
        else usageUnknown = true;
        costUsd += budget.settle(reservation, usage);
        attempts.push({ started_at: startedAt, duration_ms: durationMs, http_status: 200, error: null, transient: false });
        break;
      } else {
        costUsd += budget.settle(reservation, 0);
        const transient = TRANSIENT_STATUSES.has(last.status);
        const error = `HTTP ${last.status}: ${apiErrorMessage(last.body)}`;
        attempts.push({ started_at: startedAt, duration_ms: durationMs, http_status: last.status, error, transient });
        if (!transient) {
          finalError = error;
          break;
        }
      }

      if (attempts.length > options.maxRetries) {
        finalError = attempts.at(-1)!.error;
        break;
      }
      // Reserve the retry before waiting, so an exhausted budget neither
      // sleeps nor counts a retry it never sends.
      const next = budget.reserve(estimate());
      if (!next) {
        finalError = `${budget.exhausted}; no retry sent after: ${attempts.at(-1)!.error}`;
        break;
      }
      reservation = next;
      summary.retries += 1;
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        Math.max(
          last.kind === "http" ? (last.retryAfterMs ?? 0) : 0,
          (options.backoffBaseMs ?? 1_000) * 2 ** (attempts.length - 1) * (1 + Math.random() * 0.25),
        ),
      );
      await (options.sleep ?? delay)(backoff);
    }

    const secrets = options.secrets ?? [];
    const record: JudgmentRecord = {
      format: JUDGMENT_FORMAT,
      sample_id: task.sample.sample_id,
      trial: task.trial,
      status: "api_error",
      error: null,
      warnings: [],
      cache_key: key,
      view_sha256: viewHashes,
      reused_from: null,
      judge: {
        model: options.config.model,
        request_format: REQUEST_FORMAT,
        image_detail: options.config.image_detail,
        mock: options.client.mock,
      },
      rubric: { version: options.rubric.rubric.version, sha256: options.rubric.sha256 },
      questions: Object.fromEntries(
        DIMENSIONS.map((d) => [
          d,
          asked.some((q) => q.name === d) ? { state: "missing" } : { state: "not_applicable" },
        ]),
      ) as JudgmentRecord["questions"],
      response_model: null,
      usage: null,
      estimated_cost_usd: costUsd,
      attempts: attempts.map((a) => ({ ...a, error: a.error && redactSecrets(a.error, secrets).slice(0, 500) })),
      judge_latency_ms: Math.round(performance.now() - started),
      evaluated_at: new Date().toISOString(),
    };

    if (finalError === null && last?.kind === "http" && last.status === 200) {
      const validated = validateDecisionResponse(last.body, asked);
      if ("error" in validated) {
        record.error = `malformed response: ${validated.error}`;
      } else {
        record.status = validated.status;
        record.questions = validated.questions;
        record.usage = validated.usage;
        record.response_model = validated.model;
        record.warnings.push(...validated.problems);
      }
    } else {
      record.error = redactSecrets(finalError ?? "no response", secrets).slice(0, 500);
    }
    if (usageUnknown) record.warnings.push("an attempt had no reported usage; its cost is estimated");

    const base = judgmentPath(runId, task.sample.sample_id, task.trial).replace(/\.json$/, "");
    writeJson(`${base}.request.json`, redactImages(request, views));
    if (last?.kind === "http") writeJson(`${base}.response.json`, redactValue(last.body, secrets));
    writeJson(`${base}.json`, record);
    if (record.status === "completed") writeJson(path.join(judgmentCacheRoot, `${key}.json`), record);
    return record.status;
  };

  await pool(tasks, options.concurrency, async (task) => {
    const outcome = await runTask(task);
    summary[outcome] += 1;
    log(`${outcome.padEnd(10)} ${task.sample.sample_id}${options.trials > 1 ? ` (trial ${task.trial})` : ""}`);
  });

  summary.requests = budget.requests;
  summary.input_tokens = budget.inputTokens;
  summary.estimated_cost_usd = budget.costUsd;
  summary.unmeasured_requests = budget.unmeasured;
  summary.budget_exhausted = budget.exhausted;
  return summary;
}

function viewsIntact(runId: string, capture: CaptureRecord) {
  return capture.views.every((view) => {
    const file = path.join(sampleDir(runId, capture.sample_id), view.file);
    return existsSync(file) && sha256(readFileSync(file)) === view.sha256;
  });
}

function loadViews(runId: string, capture: CaptureRecord): JudgeView[] {
  return capture.views.map((view) => {
    const png = readFileSync(path.join(sampleDir(runId, capture.sample_id), view.file));
    return { label: view.label, sha256: view.sha256, png_base64: png.toString("base64") };
  });
}

function readCachedJudgment(key: string): JudgmentRecord | null {
  const file = path.join(judgmentCacheRoot, `${key}.json`);
  if (!existsSync(file)) return null;
  const record = readJson<JudgmentRecord>(file);
  return record.status === "completed" && record.cache_key === key ? record : null;
}

function usageOf(body: unknown): number | null {
  const usage = (body as { usage?: { input_tokens?: unknown } } | null)?.usage;
  return typeof usage?.input_tokens === "number" && Number.isFinite(usage.input_tokens) ? usage.input_tokens : null;
}

function apiErrorMessage(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message === "string") return message;
  return typeof body === "string" ? body.slice(0, 200) : "no error message";
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
