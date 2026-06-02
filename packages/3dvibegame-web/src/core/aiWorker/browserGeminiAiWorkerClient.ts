import {
  aiWorkerRequestSchema,
  buildCreateResponse,
  createPlanSchema,
} from "@3dvibegame/ai-planning";
import {
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type { AiWorkerArtifact, AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError, normalizeAiWorkerError } from "./aiWorkerErrors";
import {
  defaultGeminiModel,
  defaultGeminiTimeoutMs,
  generateCreatePlan,
} from "./geminiPlan";

export interface BrowserGeminiAiWorkerClientConfig {
  apiKey(): string | null;
  fetchImpl?: typeof fetch;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

export function createBrowserGeminiAiWorkerClient({
  apiKey,
  fetchImpl = fetch,
  model = defaultGeminiModel,
  temperature = 0.25,
  timeoutMs = defaultGeminiTimeoutMs,
}: BrowserGeminiAiWorkerClientConfig): AiWorkerClient {
  return {
    async createDraft({ prompt }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }

      const request = aiWorkerRequestSchema.parse({
        operation: "create",
        source_prompt: prompt,
        target_object_id: null,
        base_object_version: null,
        object_context: null,
      });

      try {
        const planPayload = await generateCreatePlan({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          prompt: request.source_prompt,
          temperature,
          timeoutMs,
        });
        const parsedPlan = createPlanSchema.safeParse(planPayload);
        if (!parsedPlan.success) {
          throw new AiWorkerError(
            "validation_failed",
            parsedPlan.error.issues[0]?.message ?? "Gemini returned an invalid create plan.",
          );
        }
        const plan = parsedPlan.data;
        const response = buildCreateResponse(request, plan, ["browser Gemini BYOK"]);

        return {
          jobIdBase: response.job_id_base,
          objectIdBase: response.object_id_base,
          ...toArtifact(response.source_spec, response.builder_spec),
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

function toArtifact(sourceSpec: unknown, builderSpec: unknown): AiWorkerArtifact {
  try {
    const parsedSourceSpec = parseVoxelBuilderSpec(sourceSpec);
    const parsedBuilderSpec = builderSpec as BuilderSpec;

    return {
      sourceSpec: parsedSourceSpec,
      builderSpec: parsedBuilderSpec,
      sourceSpecJson: JSON.stringify(parsedSourceSpec),
      builderSpecJson: JSON.stringify(parsedBuilderSpec),
    };
  } catch (error) {
    throw normalizeAiWorkerError(error, "validation_failed");
  }
}
