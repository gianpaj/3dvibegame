import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";

import {
  aiWorkerRequestSchema,
  compilePlanRequestSchema,
  type AiWorkerFailureCode,
  type AiWorkerFailedResponse,
  type AiWorkerRequest,
  type CreatePlanGenerator,
} from "./contracts.ts";
import { buildCreateResponse } from "./specBuilder.ts";

export interface AiWorkerServerOptions {
  allowedOrigin?: string;
  planGenerator: CreatePlanGenerator;
  timeoutMs?: number;
}

export function createAiWorkerHandler({
  allowedOrigin = "*",
  planGenerator,
  timeoutMs = 20_000,
}: AiWorkerServerOptions) {
  return async function handleAiWorkerRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    applyCors(req, res, allowedOrigin);

    if (req.method === "OPTIONS" && (req.url === "/generate" || req.url === "/compile")) {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      writeJson(res, 200, { ok: true, status: "ok" });
      return;
    }

    // /compile turns a pre-computed plan (e.g. from a browser Gemini call) into a
    // builder spec. It does not call the LLM, so it works with no API key configured.
    if (req.method === "POST" && req.url === "/compile") {
      try {
        const payload = await readJsonBody(req);
        const { operation, source_prompt, plan, warnings } =
          compilePlanRequestSchema.parse(payload);
        const request: AiWorkerRequest = {
          operation,
          source_prompt,
          target_object_id: null,
          base_object_version: null,
          object_context: null,
        };
        writeJson(res, 200, buildCreateResponse(request, plan, warnings ?? []));
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

  if (error instanceof Error) {
    const rawCode = errorCode(error);
    const code = isFailureCode(rawCode) ? rawCode : "generation_failed";
    return {
      status: code === "validation_failed" ? 400 : 500,
      response: failure(code, error.message),
    };
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
    value === "timeout"
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
