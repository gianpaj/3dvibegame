import {
  voxelBuilderSystemPrompt,
  voxelCoreSchema,
  type VoxelCore,
} from "@3dvibegame/ai-planning";

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

export interface GenerateVoxelCoreOptions {
  apiKey: string;
  fetchImpl: typeof fetch;
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs: number;
}

/**
 * Calls Gemini directly from the browser to author the actual voxel geometry
 * (object metadata + operations) for a player prompt. Returns the validated
 * creative core; the worker (or local path) assembles + compiles it.
 */
export async function generateVoxelCore({
  apiKey,
  fetchImpl,
  model,
  prompt,
  temperature,
  timeoutMs,
}: GenerateVoxelCoreOptions): Promise<VoxelCore> {
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
          parts: [{ text: voxelBuilderSystemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `Player prompt: ${prompt}` }],
          },
        ],
        // JSON mode without a strict responseSchema: the voxel op discriminated
        // union can't be expressed in Gemini's responseSchema subset, so the schema
        // lives in the system prompt and we validate the result with zod below.
        generationConfig: {
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
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
      throw new AiWorkerError("validation_failed", "Gemini returned an empty voxel spec.");
    }

    const parsed = voxelCoreSchema.safeParse(parseJsonObject(text));
    if (!parsed.success) {
      throw new AiWorkerError(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Gemini returned an invalid voxel spec.",
      );
    }
    return parsed.data;
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
