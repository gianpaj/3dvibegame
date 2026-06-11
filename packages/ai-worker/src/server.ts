import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";

import {
  aiWorkerRequestSchema,
  AiWorkerError,
  compileVoxelRequestSchema,
  coreFromSourceSpec,
  generateVoxelCore,
  generateVoxelEdit,
  type AiWorkerFailureCode,
  type AiWorkerFailedResponse,
  type AiWorkerRequest,
  type CreatePlanGenerator,
} from "./contracts.ts";
import { buildCreateResponse, buildVoxelResponse } from "./specBuilder.ts";
import { createBudgetTracker, type GeminiUsage } from "./budget.ts";
import { createRateLimiter } from "./rateLimit.ts";

// Gemini 2.5-flash with thinking is slow — use 60s for the /author endpoint.
const AUTHOR_TIMEOUT_MS = 60_000;

export interface AiWorkerServerOptions {
  allowedOrigin?: string;
  planGenerator: CreatePlanGenerator;
  timeoutMs?: number;
  geminiApiKey?: string;
  geminiModel?: string;
  dailyBudgetUsd?: number;
  rateLimitPerMin?: number;
}

export function createAiWorkerHandler({
  allowedOrigin = "*",
  planGenerator,
  timeoutMs = 20_000,
  geminiApiKey,
  geminiModel = "gemini-2.5-flash",
  dailyBudgetUsd,
  rateLimitPerMin,
}: AiWorkerServerOptions) {
  const budgetTracker = dailyBudgetUsd ? createBudgetTracker(dailyBudgetUsd) : null;
  const rateLimiter = rateLimitPerMin ? createRateLimiter(rateLimitPerMin) : null;

  return async function handleAiWorkerRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    applyCors(req, res, allowedOrigin);

    if (
      req.method === "OPTIONS" &&
      (req.url === "/generate" || req.url === "/compile" || req.url === "/author")
    ) {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      writeJson(res, 200, { ok: true, status: "ok" });
      return;
    }

    // /compile turns an LLM-authored voxel core (e.g. from a browser Gemini call)
    // into a builder spec. It does not call the LLM, so it works with no API key.
    if (req.method === "POST" && req.url === "/compile") {
      try {
        const payload = await readJsonBody(req);
        const { operation, source_prompt, voxel, warnings } =
          compileVoxelRequestSchema.parse(payload);
        const request: AiWorkerRequest = {
          operation,
          source_prompt,
          target_object_id: null,
          base_object_version: null,
          object_context: null,
        };
        writeJson(res, 200, buildVoxelResponse(request, voxel, warnings ?? []));
      } catch (error) {
        const { status, response } = normalizeError(error);
        writeJson(res, status, response);
      }
      return;
    }

    // /author: server-side Gemini key path (create or refine) with budget + rate limiting.
    if (req.method === "POST" && req.url === "/author") {
      try {
        const ip = getClientIp(req);

        if (rateLimiter) {
          rateLimiter.checkRateLimit(ip);
        }
        if (budgetTracker) {
          budgetTracker.checkBudget();
        }

        if (!geminiApiKey) {
          writeJson(
            res,
            500,
            failure("generation_failed", "Server Gemini API key is not configured."),
          );
          return;
        }

        const payload = await readJsonBody(req);
        const request = aiWorkerRequestSchema.parse(payload);

        if (request.operation !== "create" && request.operation !== "refine") {
          writeJson(
            res,
            400,
            failure("unsupported_request", "Operation must be 'create' or 'refine'."),
          );
          return;
        }

        const purpose = request.purpose ?? "object";

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AUTHOR_TIMEOUT_MS);

        let usageMetadata: GeminiUsage | null = null;

        try {
          let voxelCore;

          if (request.operation === "create") {
            const result = await generateVoxelCore({
              apiKey: geminiApiKey,
              fetchImpl: fetch,
              model: geminiModel,
              prompt: request.source_prompt,
              purpose,
              temperature: 0.35,
              timeoutMs: AUTHOR_TIMEOUT_MS,
            });
            voxelCore = result.voxelCore;
            usageMetadata = result.usageMetadata;
          } else {
            const ctx = request.object_context as Record<string, unknown> | null;
            const sourceSpecJson =
              ctx && typeof ctx.sourceSpecJson === "string" ? ctx.sourceSpecJson : null;
            const currentCore = coreFromSourceSpec(sourceSpecJson);
            if (!currentCore) {
              writeJson(
                res,
                400,
                failure(
                  "unsupported_request",
                  "This object can't be edited (missing source spec).",
                ),
              );
              return;
            }
            const result = await generateVoxelEdit({
              apiKey: geminiApiKey,
              fetchImpl: fetch,
              model: geminiModel,
              temperature: 0.35,
              timeoutMs: AUTHOR_TIMEOUT_MS,
              currentCore,
              changePrompt: request.source_prompt,
              purpose,
            });
            voxelCore = result.voxelCore;
            usageMetadata = result.usageMetadata;
          }

          const compileRequest: AiWorkerRequest = {
            operation: "create",
            source_prompt: request.source_prompt,
            target_object_id: request.target_object_id ?? null,
            base_object_version: request.base_object_version ?? null,
            object_context: null,
          };
          const response = buildVoxelResponse(compileRequest, voxelCore);

          if (budgetTracker && usageMetadata) {
            budgetTracker.recordSpend(usageMetadata);
          }

          writeJson(res, 200, response);
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        const { status, response } = normalizeError(error);
        writeJson(res, status, response);
      }
      return;
    }

    if (req.method !== "POST" || req.url !== "/generate") {
      writeJson(res, 404, failure("unsupported_request", "Route not found."));
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const request = aiWorkerRequestSchema.parse(payload);
      if (request.operation !== "create") {
        writeJson(
          res,
          400,
          failure("unsupported_request", "This AI worker slice supports create only."),
        );
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await planGenerator.generateCreatePlan({
          sourcePrompt: request.source_prompt,
          signal: controller.signal,
        });
        writeJson(res, 200, buildCreateResponse(request, result.plan, result.warnings ?? []));
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const { status, response } = normalizeError(error);
      writeJson(res, status, response);
    }
  };
}

export function startAiWorkerServer(
  options: AiWorkerServerOptions & { host: string; port: number },
) {
  const server = createServer(createAiWorkerHandler(options));
  return new Promise<ReturnType<typeof createServer>>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolveServer(server);
    });
  });
}

function getClientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigin: string) {
  const requestOrigin = req.headers.origin;
  const origin =
    allowedOrigin === "*" || !requestOrigin || requestOrigin === allowedOrigin
      ? allowedOrigin === "*"
        ? "*"
        : allowedOrigin
      : "null";
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) {
      throw Object.assign(new Error("Request body is too large."), {
        code: "validation_failed",
      });
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      code: "validation_failed",
    });
  }
}

function normalizeError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      response: failure("validation_failed", error.issues[0]?.message ?? "Invalid request."),
    };
  }

  if (isAbortError(error)) {
    return {
      status: 504,
      response: failure("timeout", "AI worker generation timed out."),
    };
  }

  if (error instanceof AiWorkerError) {
    const status =
      error.code === "budget_exhausted" || error.code === "rate_limited"
        ? 429
        : error.code === "validation_failed"
          ? 400
          : 500;
    return { status, response: failure(error.code, error.message) };
  }

  if (error instanceof Error) {
    const rawCode = errorCode(error);
    const code = isFailureCode(rawCode) ? rawCode : "generation_failed";
    const status =
      code === "budget_exhausted" || code === "rate_limited"
        ? 429
        : code === "validation_failed"
          ? 400
          : 500;
    return { status, response: failure(code, error.message) };
  }

  return {
    status: 500,
    response: failure("generation_failed", "AI worker generation failed."),
  };
}

function failure(error_code: AiWorkerFailureCode, message: string): AiWorkerFailedResponse {
  return { status: "failed", error_code, message };
}

function errorCode(error: Error) {
  return (error as Error & { code?: unknown }).code;
}

function isFailureCode(value: unknown): value is AiWorkerFailureCode {
  return (
    value === "invalid_prompt" ||
    value === "unsupported_request" ||
    value === "unsafe_request" ||
    value === "context_stale" ||
    value === "generation_failed" ||
    value === "validation_failed" ||
    value === "timeout" ||
    value === "budget_exhausted" ||
    value === "rate_limited"
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
