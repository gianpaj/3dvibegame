import { createPlanJsonSchema, createPlanSystemPrompt } from "@3dvibegame/ai-planning";

import { AiWorkerError } from "./aiWorkerErrors";

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

export const defaultGeminiModel = "gemini-2.5-flash";
export const defaultGeminiTimeoutMs = 45_000;

export interface GenerateCreatePlanOptions {
  apiKey: string;
  fetchImpl: typeof fetch;
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs: number;
}

/**
 * Calls Gemini directly from the browser to produce a raw create-plan JSON object.
 * Shared by the local-compile and worker-compile browser clients so the request,
 * schema, and timeout behaviour stay identical.
 */
export async function generateCreatePlan({
  apiKey,
  fetchImpl,
  model,
  prompt,
  temperature,
  timeoutMs,
}: GenerateCreatePlanOptions): Promise<unknown> {
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
