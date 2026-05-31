import type { AiWorkerClient } from "./fixtureAiWorkerClient";
import { createFixtureAiWorkerClient } from "./fixtureAiWorkerClient";
import { createHttpAiWorkerClient } from "./httpAiWorkerClient";

export function createConfiguredAiWorkerClient(): AiWorkerClient {
  const workerUrl = stringEnv("VITE_AI_WORKER_URL");
  if (!workerUrl) {
    return createFixtureAiWorkerClient();
  }

  return createHttpAiWorkerClient({
    url: workerUrl,
    timeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
  });
}

function stringEnv(key: string) {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberEnv(key: string) {
  const raw = stringEnv(key);
  if (!raw) return null;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
