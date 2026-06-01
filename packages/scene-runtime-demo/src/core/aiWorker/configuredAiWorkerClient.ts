import type { AiWorkerClient } from "./fixtureAiWorkerClient";
import { createBrowserGeminiAiWorkerClient } from "./browserGeminiAiWorkerClient";
import { createFixtureAiWorkerClient } from "./fixtureAiWorkerClient";
import { createHttpAiWorkerClient } from "./httpAiWorkerClient";

export interface ConfiguredAiWorkerClientOptions {
  getBrowserGeminiApiKey?: () => string | null;
}

export function createConfiguredAiWorkerClient({
  getBrowserGeminiApiKey,
}: ConfiguredAiWorkerClientOptions = {}): AiWorkerClient {
  const fixtureClient = createFixtureAiWorkerClient();
  const workerUrl = stringEnv("VITE_AI_WORKER_URL");
  const httpClient = workerUrl
    ? createHttpAiWorkerClient({
        url: workerUrl,
        timeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
      })
    : null;
  const browserGeminiClient = getBrowserGeminiApiKey
    ? createBrowserGeminiAiWorkerClient({
        apiKey: getBrowserGeminiApiKey,
        model: stringEnv("VITE_BROWSER_GEMINI_MODEL") ?? undefined,
        timeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
      })
    : null;

  return {
    createDraft(input) {
      if (browserGeminiClient && getBrowserGeminiApiKey?.()?.trim()) {
        return browserGeminiClient.createDraft(input);
      }
      if (httpClient) {
        return httpClient.createDraft(input);
      }
      return fixtureClient.createDraft(input);
    },
    createEdit: fixtureClient.createEdit,
  };
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
