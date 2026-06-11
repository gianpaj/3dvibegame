import "dotenv/config";

import {
  createGeminiPlanGenerator,
  createStaticPlanGenerator,
} from "./geminiPlanGenerator.ts";
import { startAiWorkerServer } from "./server.ts";

const host = process.env.AI_WORKER_HOST ?? "127.0.0.1";
const port = numberEnv("AI_WORKER_PORT") ?? 8787;
const timeoutMs = numberEnv("AI_WORKER_TIMEOUT_MS") ?? 20_000;
const allowedOrigin = process.env.AI_WORKER_ALLOWED_ORIGIN ?? "*";
const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
const geminiModel = process.env.AI_WORKER_MODEL ?? "gemini-2.5-flash";
const dailyBudgetUsd = numberEnv("AI_WORKER_DAILY_BUDGET_USD") ?? undefined;
const rateLimitPerMin = numberEnv("AI_WORKER_RATE_LIMIT_PER_MIN") ?? undefined;

const planGenerator =
  process.env.AI_WORKER_FAKE === "1"
    ? createStaticPlanGenerator()
    : createGeminiPlanGenerator();

await startAiWorkerServer({
  allowedOrigin,
  host,
  planGenerator,
  port,
  timeoutMs,
  geminiApiKey,
  geminiModel,
  dailyBudgetUsd,
  rateLimitPerMin,
});

console.log(`ai-worker listening on http://${host}:${port}`);

function numberEnv(key: string) {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
