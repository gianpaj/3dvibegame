import type {
  AiWorkerClient,
  AiWorkerObjectContext,
} from "./fixtureAiWorkerClient";
import { normalizeAiWorkerError } from "./aiWorkerErrors";
import {
  normalizeEndpoint,
  postWorkerJson,
  workerResponseToArtifact,
} from "./workerResponse";

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
  purpose?: "object" | "avatar";
}

// Gemini with thinking enabled is slow — use 60s to match the server's author timeout.
const defaultTimeoutMs = 60_000;

export function createHttpAiWorkerClient({
  url,
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
}: HttpAiWorkerClientConfig): AiWorkerClient {
  const base = normalizeEndpoint(url).replace(/\/+$/, "");
  const authorEndpoint = `${base}/author`;

  return {
    async createDraft({ prompt, purpose }) {
      try {
        const body: HttpAiWorkerRequest = {
          operation: "create",
          source_prompt: prompt,
          target_object_id: null,
          base_object_version: null,
          object_context: null,
          purpose,
        };
        const response = await postWorkerJson(fetchImpl, authorEndpoint, timeoutMs, body);

        return {
          jobIdBase: response.job_id_base ?? response.jobIdBase ?? "http_worker_job",
          objectIdBase:
            response.object_id_base ?? response.objectIdBase ?? "http_worker_object",
          quantity: response.quantity ?? 1,
          ...workerResponseToArtifact(response, "http-worker"),
          avatarScale: response.scale,
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
    async createEdit({ actionId, baseObjectId, baseVersion, sourcePrompt, objectContext, purpose }) {
      try {
        const body: HttpAiWorkerRequest = {
          operation: "refine",
          source_prompt: sourcePrompt ?? actionId ?? "edit",
          action_id: actionId,
          target_object_id: baseObjectId,
          base_object_version: baseVersion,
          object_context: objectContext ?? null,
          purpose,
        };
        const response = await postWorkerJson(fetchImpl, authorEndpoint, timeoutMs, body);

        return {
          ...workerResponseToArtifact(response, "http-worker"),
          avatarScale: response.scale,
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
  };
}
