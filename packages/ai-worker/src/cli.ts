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
});

console.log(`ai-worker listening on http://${host}:${port}`);

function numberEnv(key: string) {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
