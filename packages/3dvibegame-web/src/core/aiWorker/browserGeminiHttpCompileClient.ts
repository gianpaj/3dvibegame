import { createPlanSchema, type CompilePlanRequest } from "@3dvibegame/ai-planning";

import type { AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError, normalizeAiWorkerError } from "./aiWorkerErrors";
import {
  defaultGeminiModel,
  defaultGeminiTimeoutMs,
  generateCreatePlan,
} from "./geminiPlan";
import {
  normalizeEndpoint,
  postWorkerJson,
  workerResponseToArtifact,
} from "./workerResponse";

export interface BrowserGeminiHttpCompileClientConfig {
  apiKey(): string | null;
  workerUrl: string;
  fetchImpl?: typeof fetch;
  model?: string;
  temperature?: number;
  geminiTimeoutMs?: number;
  workerTimeoutMs?: number;
}

const defaultWorkerTimeoutMs = 20_000;

/**
 * Hybrid create client: the browser calls Gemini directly (BYOK key never leaves
 * the browser) to get a create plan, then POSTs that plan to the AI worker's
 * /compile endpoint, which deterministically turns it into a builder spec.
 */
export function createBrowserGeminiHttpCompileClient({
  apiKey,
  workerUrl,
  fetchImpl = fetch,
  model = defaultGeminiModel,
  temperature = 0.25,
  geminiTimeoutMs = defaultGeminiTimeoutMs,
  workerTimeoutMs = defaultWorkerTimeoutMs,
}: BrowserGeminiHttpCompileClientConfig): AiWorkerClient {
  const compileEndpoint = `${normalizeEndpoint(workerUrl).replace(/\/+$/, "")}/compile`;

  return {
    async createDraft({ prompt }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }

      const sourcePrompt = prompt.trim();

      try {
        const planPayload = await generateCreatePlan({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          prompt: sourcePrompt,
          temperature,
          timeoutMs: geminiTimeoutMs,
        });
        const parsedPlan = createPlanSchema.safeParse(planPayload);
        if (!parsedPlan.success) {
          throw new AiWorkerError(
            "validation_failed",
            parsedPlan.error.issues[0]?.message ?? "Gemini returned an invalid create plan.",
          );
        }

        const body: CompilePlanRequest = {
          operation: "create",
          source_prompt: sourcePrompt,
          plan: parsedPlan.data,
          warnings: ["browser Gemini BYOK"],
        };
        const response = await postWorkerJson(
          fetchImpl,
          compileEndpoint,
          workerTimeoutMs,
          body,
        );

        return {
          jobIdBase: response.job_id_base ?? response.jobIdBase ?? "compile_job",
          objectIdBase: response.object_id_base ?? response.objectIdBase ?? "compile_object",
          ...workerResponseToArtifact(response),
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
    async createEdit() {
      throw new AiWorkerError(
        "unsupported_request",
        "Browser Gemini mode currently supports create only.",
      );
    },
  };
}
