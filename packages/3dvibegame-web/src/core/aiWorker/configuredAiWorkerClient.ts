import type { AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError } from "./aiWorkerErrors";
import { createBrowserGeminiAiWorkerClient } from "./browserGeminiAiWorkerClient";
import { createBrowserGeminiHttpCompileClient } from "./browserGeminiHttpCompileClient";
import { createFixtureAiWorkerClient } from "./fixtureAiWorkerClient";
import { createHttpAiWorkerClient } from "./httpAiWorkerClient";

export type AiClientMode = "browser-gemini" | "http-worker" | "fixture";

export interface ConfiguredAiWorkerClientOptions {
  getBrowserGeminiApiKey?: () => string | null;
}

export const missingBrowserGeminiKeyMessage =
  "Browser Gemini API key is missing. Add your Gemini API key in Settings.";

export function isMissingBrowserGeminiKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(missingBrowserGeminiKeyMessage);
}

export function resolveAiClientMode(): AiClientMode {
  const mode = stringEnv("VITE_AI_CLIENT_MODE");
  if (mode === "browser-gemini") return "browser-gemini";
  if (mode === "http-worker") return "http-worker";
  return "fixture";
}

export function createConfiguredAiWorkerClient({
  getBrowserGeminiApiKey,
}: ConfiguredAiWorkerClientOptions = {}): AiWorkerClient {
  const fixtureClient = createFixtureAiWorkerClient();
  const clientMode = resolveAiClientMode();
  const workerUrl = stringEnv("VITE_AI_WORKER_URL");
  const httpWorkerRequested = clientMode === "http-worker";
  const browserGeminiRequested = clientMode === "browser-gemini";
  const httpClient = httpWorkerRequested && workerUrl
    ? createHttpAiWorkerClient({
        url: workerUrl,
        timeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
      })
    : null;
  // In browser-gemini mode the browser always owns the Gemini call. When a worker
  // URL is set, the resulting plan is compiled on the worker (/compile); otherwise
  // it is compiled locally in the browser. Either way the key stays in the browser.
  const browserGeminiClient = getBrowserGeminiApiKey
    ? workerUrl
      ? createBrowserGeminiHttpCompileClient({
          apiKey: getBrowserGeminiApiKey,
          workerUrl,
          model: stringEnv("VITE_BROWSER_GEMINI_MODEL") ?? undefined,
          geminiTimeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
          workerTimeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
        })
      : createBrowserGeminiAiWorkerClient({
          apiKey: getBrowserGeminiApiKey,
          model: stringEnv("VITE_BROWSER_GEMINI_MODEL") ?? undefined,
          timeoutMs: numberEnv("VITE_AI_WORKER_TIMEOUT_MS") ?? undefined,
        })
    : null;

  return {
    createDraft(input) {
      const hasBrowserGeminiKey = Boolean(getBrowserGeminiApiKey?.()?.trim());
      if (browserGeminiClient && hasBrowserGeminiKey) {
        return browserGeminiClient.createDraft(input);
      }
      if (browserGeminiRequested) {
        throw new AiWorkerError("generation_failed", missingBrowserGeminiKeyMessage);
      }
      if (httpWorkerRequested) {
        if (!httpClient) {
          throw new Error("VITE_AI_CLIENT_MODE=http-worker requires VITE_AI_WORKER_URL.");
        }
        return httpClient.createDraft(input);
      }
      return fixtureClient.createDraft(input);
    },
    createEdit(input) {
      // Route edits the same way as creates: prefer the browser-Gemini client when a
      // BYOK key is present, then the HTTP worker, then the fixture recipes. (The old
      // fixture-only wiring made every live free-form edit throw "Fixture AI worker
      // does not have that refine recipe".)
      const hasBrowserGeminiKey = Boolean(getBrowserGeminiApiKey?.()?.trim());
      if (browserGeminiClient && hasBrowserGeminiKey) {
        return browserGeminiClient.createEdit(input);
      }
      if (browserGeminiRequested) {
        throw new AiWorkerError("generation_failed", missingBrowserGeminiKeyMessage);
      }
      if (httpWorkerRequested) {
        if (!httpClient) {
          throw new Error("VITE_AI_CLIENT_MODE=http-worker requires VITE_AI_WORKER_URL.");
        }
        return httpClient.createEdit(input);
      }
      return fixtureClient.createEdit(input);
    },
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
