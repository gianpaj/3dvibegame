import {
  aiWorkerRequestSchema,
  buildCreateResponse,
  createPlanJsonSchema,
  createPlanSchema,
  createPlanSystemPrompt,
} from "@3dvibegame/ai-planning";
import {
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import type { AiWorkerArtifact, AiWorkerClient } from "./fixtureAiWorkerClient";
import { AiWorkerError, normalizeAiWorkerError } from "./aiWorkerErrors";

export interface BrowserGeminiAiWorkerClientConfig {
  apiKey(): string | null;
  fetchImpl?: typeof fetch;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

const defaultModel = "gemini-2.5-flash";
const defaultTimeoutMs = 45_000;

export function createBrowserGeminiAiWorkerClient({
  apiKey,
  fetchImpl = fetch,
  model = defaultModel,
  temperature = 0.25,
  timeoutMs = defaultTimeoutMs,
}: BrowserGeminiAiWorkerClientConfig): AiWorkerClient {
  return {
    async createDraft({ prompt }) {
      const trimmedKey = apiKey()?.trim();
      if (!trimmedKey) {
        throw new AiWorkerError("generation_failed", "Browser Gemini key is not configured.");
      }

      const request = aiWorkerRequestSchema.parse({
        operation: "create",
        source_prompt: prompt,
        target_object_id: null,
        base_object_version: null,
        object_context: null,
      });

      try {
        const planPayload = await generateCreatePlan({
          apiKey: trimmedKey,
          fetchImpl,
          model,
          prompt: request.source_prompt,
          temperature,
          timeoutMs,
        });
        const parsedPlan = createPlanSchema.safeParse(planPayload);
        if (!parsedPlan.success) {
          throw new AiWorkerError(
            "validation_failed",
            parsedPlan.error.issues[0]?.message ?? "Gemini returned an invalid create plan.",
          );
        }
        const plan = parsedPlan.data;
        const response = buildCreateResponse(request, plan, ["browser Gemini BYOK"]);

        return {
          jobIdBase: response.job_id_base,
          objectIdBase: response.object_id_base,
          ...toArtifact(response.source_spec, response.builder_spec),
        };
      } catch (error) {
        throw normalizeAiWorkerError(error);
      }
    },
    async createEdit() {
      throw new AiWorkerError(
        "unsupported_request",
        "Browser Gemini mode currently supports create only.",
      );
    },
  };
}

async function generateCreatePlan({
  apiKey,
  fetchImpl,
  model,
  prompt,
  temperature,
  timeoutMs,
}: {
  apiKey: string;
  fetchImpl: typeof fetch;
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(geminiGenerateContentUrl(model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: createPlanSystemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `Player prompt: ${prompt}` }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 900,
          responseMimeType: "application/json",
          responseSchema: createPlanJsonSchema,
          temperature,
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | GeminiGenerateContentResponse
      | null;

    if (!response.ok) {
      throw new AiWorkerError(
        "generation_failed",
        payload?.error?.message ?? `Gemini HTTP ${response.status}`,
      );
    }

    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new AiWorkerError("validation_failed", "Gemini returned an empty create plan.");
    }

    return parseJsonObject(text);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiWorkerError("timeout", `Gemini timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function geminiGenerateContentUrl(model: string) {
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  return `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new AiWorkerError("validation_failed", "Gemini response was not JSON.");
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new AiWorkerError("validation_failed", "Gemini response JSON could not be parsed.");
    }
  }
}

function toArtifact(sourceSpec: unknown, builderSpec: unknown): AiWorkerArtifact {
  try {
    const parsedSourceSpec = parseVoxelBuilderSpec(sourceSpec);
    const parsedBuilderSpec = builderSpec as BuilderSpec;

    return {
      sourceSpec: parsedSourceSpec,
      builderSpec: parsedBuilderSpec,
      sourceSpecJson: JSON.stringify(parsedSourceSpec),
      builderSpecJson: JSON.stringify(parsedBuilderSpec),
    };
  } catch (error) {
    throw normalizeAiWorkerError(error, "validation_failed");
  }
}
