import { createHash } from "node:crypto";

import type { DecisionRequest } from "./request.ts";

export type ClientResult =
  | { kind: "http"; status: number; body: unknown; retryAfterMs: number | null }
  | { kind: "network_error"; error: string; timedOut: boolean };

export interface DecisionsClient {
  readonly mock: boolean;
  send(request: DecisionRequest, deadlineMs: number): Promise<ClientResult>;
}

export const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";

// Minimal client for POST /v1/decisions. The key stays in this object: it is
// never written to records, and error text is redacted before it is saved.
export class HttpDecisionsClient implements DecisionsClient {
  readonly mock = false;

  constructor(
    private readonly apiKey: string,
    private readonly options: { endpoint?: string; fetchImpl?: typeof fetch } = {},
  ) {}

  async send(request: DecisionRequest, deadlineMs: number): Promise<ClientResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(this.options.endpoint ?? DECISIONS_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(deadlineMs),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Keep non-JSON bodies (gateway errors) as text.
      }
      return {
        kind: "http",
        status: response.status,
        body,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      };
    } catch (error) {
      const name = (error as Error).name;
      const timedOut = name === "TimeoutError" || name === "AbortError";
      return {
        kind: "network_error",
        error: timedOut ? `request exceeded the ${deadlineMs} ms deadline` : `network error: ${(error as Error).message}`,
        timedOut,
      };
    }
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// Deterministic offline stand-in for pipeline runs without an API key. Scores
// are derived from a hash of the request, so they are stable but carry no
// information about visual quality. Records made with it are marked mock.
export class MockDecisionsClient implements DecisionsClient {
  readonly mock = true;

  async send(request: DecisionRequest): Promise<ClientResult> {
    const seed = createHash("sha256").update(JSON.stringify(request)).digest();
    const answers = request.questions.map((question, q) => {
      const weights = question.levels.map((_, i) => 1 + seed[(q * 8 + i) % seed.length]!);
      const total = weights.reduce((a, b) => a + b, 0);
      const probabilities = question.levels.map((level, i) => ({
        value: i,
        label: level.label,
        probability: weights[i]! / total,
      }));
      return {
        type: "score",
        name: question.name,
        score: probabilities.reduce((sum, p) => sum + p.value * p.probability, 0),
        confidence: Math.max(...probabilities.map((p) => p.probability)),
        probabilities,
      };
    });
    const inputTokens = Math.round(JSON.stringify(request).length / 1000);
    return {
      kind: "http",
      status: 200,
      retryAfterMs: null,
      body: {
        model: "mock",
        answers,
        usage: { input_tokens: inputTokens, output_tokens: 0, total_tokens: inputTokens },
      },
    };
  }
}
