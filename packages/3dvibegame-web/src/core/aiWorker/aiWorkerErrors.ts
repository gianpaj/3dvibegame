import {
  AiWorkerError,
  aiWorkerFailureCodes,
  type AiWorkerFailureCode,
} from "@3dvibegame/ai-planning";

export { AiWorkerError, type AiWorkerFailureCode };

const supportedFailureCodes = new Set<AiWorkerFailureCode>(aiWorkerFailureCodes);

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
    case "budget_exhausted":
      return "Daily AI limit reached — try again tomorrow.";
    case "rate_limited":
      return "Too many requests — please wait a moment.";
    default:
      code satisfies never;
      return "AI worker failed.";
  }
}
