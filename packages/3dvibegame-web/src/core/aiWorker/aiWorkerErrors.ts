export type AiWorkerFailureCode =
  | "invalid_prompt"
  | "unsupported_request"
  | "unsafe_request"
  | "context_stale"
  | "generation_failed"
  | "validation_failed"
  | "timeout";

const supportedFailureCodes = new Set<AiWorkerFailureCode>([
  "invalid_prompt",
  "unsupported_request",
  "unsafe_request",
  "context_stale",
  "generation_failed",
  "validation_failed",
  "timeout",
]);

export class AiWorkerError extends Error {
  readonly code: AiWorkerFailureCode;

  constructor(code: AiWorkerFailureCode, message: string) {
    super(message);
    this.name = "AiWorkerError";
    this.code = code;
  }
}

export function normalizeAiWorkerError(
  error: unknown,
  fallbackCode: AiWorkerFailureCode = "generation_failed",
): AiWorkerError {
  if (error instanceof AiWorkerError) return error;

  const message = error instanceof Error && error.message ? error.message : null;
  return new AiWorkerError(
    fallbackCode,
    message ?? aiWorkerFailureLabel(fallbackCode),
  );
}

export function aiWorkerFailureCodeFromUnknown(
  value: unknown,
  fallback: AiWorkerFailureCode = "generation_failed",
): AiWorkerFailureCode {
  return typeof value === "string" && supportedFailureCodes.has(value as AiWorkerFailureCode)
    ? (value as AiWorkerFailureCode)
    : fallback;
}

export function aiWorkerFailureLabel(code: AiWorkerFailureCode) {
  switch (code) {
    case "invalid_prompt":
      return "Prompt needs a clearer build request.";
    case "unsupported_request":
      return "That request is outside the current builder scope.";
    case "unsafe_request":
      return "That request was blocked by worker safety checks.";
    case "context_stale":
      return "The object changed before the worker response arrived.";
    case "generation_failed":
      return "AI worker generation failed.";
    case "validation_failed":
      return "AI worker returned an invalid build artifact.";
    case "timeout":
      return "AI worker timed out.";
    default:
      code satisfies never;
      return "AI worker failed.";
  }
}
