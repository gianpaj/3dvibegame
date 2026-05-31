import {
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type {
  AiWorkerArtifact,
  AiWorkerClient,
  AiWorkerObjectContext,
} from "./fixtureAiWorkerClient";
import {
  AiWorkerError,
  aiWorkerFailureCodeFromUnknown,
  normalizeAiWorkerError,
} from "./aiWorkerErrors";

export interface HttpAiWorkerClientConfig {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type HttpAiWorkerOperation = "create" | "refine";

export interface HttpAiWorkerRequest {
  operation: HttpAiWorkerOperation;
  source_prompt: string;
  action_id?: string;
  target_object_id: string | null;
  base_object_version: number | null;
  object_context: AiWorkerObjectContext | null;
}

export interface HttpAiWorkerResponse {
  status?: string;
  job_id_base?: string;
  jobIdBase?: string;
  object_id_base?: string;
  objectIdBase?: string;
  source_spec?: unknown;
  sourceSpec?: unknown;
  builder_spec?: unknown;
  builderSpec?: unknown;
  error_code?: string;
  errorCode?: string;
  message?: string;
}

const defaultTimeoutMs = 20_000;

export function createHttpAiWorkerClient({
  url,
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
}: HttpAiWorkerClientConfig): AiWorkerClient {
  const endpoint = normalizeEndpoint(url);

  return {
    async createDraft({ prompt }) {
      try {
        const response = await postWorkerRequest(fetchImpl, endpoint, timeoutMs, {
          operation: "create",
          source_prompt: prompt,
          target_object_id: null,
          base_object_version: null,
          object_context: null,
        });

        return {
          jobIdBase: response.job_id_base ?? response.jobIdBase ?? "http_worker_job",
          objectIdBase:
            response.object_id_base ?? response.objectIdBase ?? "http_worker_object",
          ...toArtifact(response),
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
    async createEdit({ actionId, baseObjectId, baseVersion, sourcePrompt, objectContext }) {
      try {
        const response = await postWorkerRequest(fetchImpl, endpoint, timeoutMs, {
          operation: "refine",
          source_prompt: sourcePrompt ?? actionId,
          action_id: actionId,
          target_object_id: baseObjectId,
          base_object_version: baseVersion,
          object_context: objectContext ?? null,
        });

        return toArtifact(response);
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
  };
}

async function postWorkerRequest(
  fetchImpl: typeof fetch,
  endpoint: string,
  timeoutMs: number,
  body: HttpAiWorkerRequest,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AiWorkerError(
        workerErrorCode(payload),
        workerErrorMessage(payload, `HTTP ${response.status}`),
      );
    }

    return parseWorkerResponse(payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiWorkerError("timeout", `AI worker timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseWorkerResponse(payload: unknown): HttpAiWorkerResponse {
  if (!isRecord(payload)) {
    throw new AiWorkerError(
      "validation_failed",
      "AI worker returned a non-object response.",
    );
  }

  const status = typeof payload.status === "string" ? payload.status : "completed";
  if (status !== "completed") {
    throw new AiWorkerError(
      workerErrorCode(payload),
      workerErrorMessage(payload, `AI worker returned ${status}`),
    );
  }

  const response = payload as HttpAiWorkerResponse;
  if (!isRecord(response.source_spec ?? response.sourceSpec)) {
    throw new AiWorkerError(
      "validation_failed",
      "AI worker response is missing source_spec.",
    );
  }
  if (!isRecord(response.builder_spec ?? response.builderSpec)) {
    throw new AiWorkerError(
      "validation_failed",
      "AI worker response is missing builder_spec.",
    );
  }

  return response;
}

function toArtifact(response: HttpAiWorkerResponse): AiWorkerArtifact {
  try {
    const sourceSpec = parseVoxelBuilderSpec(response.source_spec ?? response.sourceSpec);
    const builderSpec = parseBuilderSpec(response.builder_spec ?? response.builderSpec);

    return {
      sourceSpec,
      builderSpec,
      sourceSpecJson: JSON.stringify(sourceSpec),
      builderSpecJson: JSON.stringify(builderSpec),
    };
  } catch (error) {
    throw normalizeAiWorkerError(error, "validation_failed");
  }
}

function parseBuilderSpec(value: unknown): BuilderSpec {
  if (!isRecord(value)) {
    throw new AiWorkerError(
      "validation_failed",
      "AI worker builder_spec must be an object.",
    );
  }

  return value as unknown as BuilderSpec;
}

function workerErrorCode(payload: unknown) {
  if (!isRecord(payload)) return "generation_failed";

  return aiWorkerFailureCodeFromUnknown(
    typeof payload.error_code === "string" ? payload.error_code : payload.errorCode,
  );
}

function workerErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;

  const message = typeof payload.message === "string" ? payload.message : fallback;
  const code =
    typeof payload.error_code === "string"
      ? payload.error_code
      : typeof payload.errorCode === "string"
        ? payload.errorCode
        : null;

  return code ? `${message} (${code})` : message;
}

function normalizeEndpoint(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("AI worker URL is empty.");
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
