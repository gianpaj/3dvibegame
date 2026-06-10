import type { CompileVoxelRequest } from "@3dvibegame/ai-planning";

import type { AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError, normalizeAiWorkerError } from "./aiWorkerErrors";
import {
  coreFromSourceSpec,
  defaultGeminiModel,
  defaultGeminiTimeoutMs,
  generateVoxelCore,
  generateVoxelEdit,
} from "./geminiVoxel";
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
 * the browser) to author the voxel geometry, then POSTs that voxel core to the AI
 * worker's /compile endpoint, which grounds, validates, and compiles it.
 */
export function createBrowserGeminiHttpCompileClient({
  apiKey,
  workerUrl,
  fetchImpl = fetch,
  model = defaultGeminiModel,
  temperature = 0.35,
  geminiTimeoutMs = defaultGeminiTimeoutMs,
  workerTimeoutMs = defaultWorkerTimeoutMs,
}: BrowserGeminiHttpCompileClientConfig): AiWorkerClient {
  const compileEndpoint = `${normalizeEndpoint(workerUrl).replace(/\/+$/, "")}/compile`;

  return {
    async createDraft({ prompt, purpose }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }

      const sourcePrompt = prompt.trim();

      try {
        const voxel = await generateVoxelCore({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          prompt: sourcePrompt,
          purpose,
          temperature,
          timeoutMs: geminiTimeoutMs,
        });

        const body: CompileVoxelRequest = {
          operation: "create",
          source_prompt: sourcePrompt,
          voxel,
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
          quantity: voxel.quantity ?? 1,
          ...workerResponseToArtifact(response, model),
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

      try {
        const voxel = await generateVoxelEdit({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          temperature,
          timeoutMs: geminiTimeoutMs,
          currentCore,
          changePrompt,
          purpose,
        });

        const body: CompileVoxelRequest = {
          operation: "create",
          source_prompt: changePrompt,
          voxel,
          warnings: ["browser Gemini BYOK edit"],
        };
        const response = await postWorkerJson(
          fetchImpl,
          compileEndpoint,
          workerTimeoutMs,
          body,
        );
        return workerResponseToArtifact(response, model);
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
  };
}
