import {
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type { AiWorkerArtifact } from "./fixtureAiWorkerClient";
import {
  AiWorkerError,
  aiWorkerFailureCodeFromUnknown,
  normalizeAiWorkerError,
} from "./aiWorkerErrors";

export interface WorkerResponse {
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
  model?: string;
  model_id?: string;
  quantity?: number;
  scale?: number;
}

/**
 * POSTs a JSON body to an AI-worker endpoint and returns the validated completed
 * response. Shared by the prompt-based `/generate` client and the plan-based
 * `/compile` client so timeout, abort, and error handling stay identical.
 */
export async function postWorkerJson(
  fetchImpl: typeof fetch,
  endpoint: string,
  timeoutMs: number,
  body: unknown,
): Promise<WorkerResponse> {
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

export function workerResponseToArtifact(
  response: WorkerResponse,
  fallbackModelId: string,
): AiWorkerArtifact {
  try {
    const sourceSpec = parseVoxelBuilderSpec(response.source_spec ?? response.sourceSpec);
    const builderSpec = parseBuilderSpec(response.builder_spec ?? response.builderSpec);

    return {
      sourceSpec,
      builderSpec,
      sourceSpecJson: JSON.stringify(sourceSpec),
      builderSpecJson: JSON.stringify(builderSpec),
      modelId: response.model ?? response.model_id ?? fallbackModelId,
    };
  } catch (error) {
    throw normalizeAiWorkerError(error, "validation_failed");
  }
}

export function normalizeEndpoint(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("AI worker URL is empty.");
  }
  return trimmed;
}

function parseWorkerResponse(payload: unknown): WorkerResponse {
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

  const response = payload as WorkerResponse;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
