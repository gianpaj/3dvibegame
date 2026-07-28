import {
  buildVoxelResponse,
  type AiWorkerRequest,
} from "@3dvibegame/ai-planning";
import {
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type { AiWorkerArtifact, AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError, normalizeAiWorkerError } from "./aiWorkerErrors";
import {
  coreFromSourceSpec,
  defaultGeminiModel,
  defaultGeminiTimeoutMs,
  generateVoxelCore,
  generateVoxelEdit,
} from "./geminiVoxel";

export interface BrowserGeminiAiWorkerClientConfig {
  apiKey(): string | null;
  fetchImpl?: typeof fetch;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Local-compile browser client (no worker URL): the browser calls Gemini for the
 * voxel geometry and assembles + compiles it in-process via buildVoxelResponse.
 */
export function createBrowserGeminiAiWorkerClient({
  apiKey,
  fetchImpl = fetch,
  model = defaultGeminiModel,
  temperature = 0.35,
  timeoutMs = defaultGeminiTimeoutMs,
}: BrowserGeminiAiWorkerClientConfig): AiWorkerClient {
  return {
    async createDraft({ prompt, purpose }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }

      const sourcePrompt = prompt.trim();
      const request: AiWorkerRequest = {
        operation: "create",
        source_prompt: sourcePrompt,
        target_object_id: null,
        base_object_version: null,
        object_context: null,
      };

      try {
        const { voxelCore: voxel } = await generateVoxelCore({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          prompt: sourcePrompt,
          purpose,
          temperature,
          timeoutMs,
        });
        const response = buildVoxelResponse(request, voxel, ["browser Gemini BYOK"]);

        return {
          jobIdBase: response.job_id_base,
          objectIdBase: response.object_id_base,
          quantity: voxel.quantity ?? 1,
          ...toArtifact(response.source_spec, response.builder_spec, model),
          avatarScale: voxel.scale,
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
    async createEdit({ sourcePrompt, objectContext, purpose }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }
      const changePrompt = (sourcePrompt ?? "").trim();
      const currentCore = coreFromSourceSpec(objectContext?.sourceSpecJson);
      if (!currentCore) {
        throw new AiWorkerError(
          "unsupported_request",
          "This object can't be edited (missing source spec).",
        );
      }

      const request: AiWorkerRequest = {
        operation: "create",
        source_prompt: changePrompt,
        target_object_id: null,
        base_object_version: null,
        object_context: null,
      };

      try {
        const { voxelCore: voxel } = await generateVoxelEdit({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          temperature,
          timeoutMs,
          currentCore,
          changePrompt,
          purpose,
        });
        const response = buildVoxelResponse(request, voxel, ["browser Gemini BYOK edit"]);
        return {
          ...toArtifact(response.source_spec, response.builder_spec, model),
          avatarScale: voxel.scale,
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
  };
}

function toArtifact(
  sourceSpec: unknown,
  builderSpec: unknown,
  modelId: string,
): AiWorkerArtifact {
  try {
    const parsedSourceSpec = parseVoxelBuilderSpec(sourceSpec);
    const parsedBuilderSpec = builderSpec as BuilderSpec;

    return {
      sourceSpec: parsedSourceSpec,
      builderSpec: parsedBuilderSpec,
      sourceSpecJson: JSON.stringify(parsedSourceSpec),
      builderSpecJson: JSON.stringify(parsedBuilderSpec),
      modelId,
    };
  } catch (error) {
    throw normalizeAiWorkerError(error, "validation_failed");
  }
}
