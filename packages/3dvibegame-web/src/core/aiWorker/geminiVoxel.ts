import {
  avatarSystemPrompt,
  voxelBuilderSystemPrompt,
  voxelCoreSchema,
  voxelEditSystemPrompt,
  type VoxelCore,
} from "@3dvibegame/ai-planning";
import { parseVoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { AiWorkerError } from "./aiWorkerErrors";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export const defaultGeminiModel = "gemini-2.5-flash";
export const defaultGeminiTimeoutMs = 45_000;

interface GeminiCallOptions {
  apiKey: string;
  fetchImpl: typeof fetch;
  model: string;
  temperature: number;
  timeoutMs: number;
}

/** What the voxel core is for: a world object (default) or the player's avatar body. */
export type VoxelPurpose = "object" | "avatar";

export interface GenerateVoxelCoreOptions extends GeminiCallOptions {
  prompt: string;
  purpose?: VoxelPurpose;
}

export interface GenerateVoxelEditOptions extends GeminiCallOptions {
  currentCore: VoxelCore;
  changePrompt: string;
  purpose?: VoxelPurpose;
}

/**
 * Calls Gemini directly from the browser to author the actual voxel geometry
 * (object metadata + operations) for a player prompt. Returns the validated
 * creative core; the worker (or local path) assembles + compiles it.
 */
export function generateVoxelCore({
  prompt,
  purpose = "object",
  ...call
}: GenerateVoxelCoreOptions): Promise<VoxelCore> {
  const systemPrompt =
    purpose === "avatar" ? avatarSystemPrompt : voxelBuilderSystemPrompt;
  return requestVoxelCore(call, systemPrompt, `Player prompt: ${prompt}`);
}

/**
 * Calls Gemini to edit an existing object: it gets the current voxel core plus a
 * change request and returns the full edited core (same shape as create).
 */
export function generateVoxelEdit({
  currentCore,
  changePrompt,
  purpose = "object",
  ...call
}: GenerateVoxelEditOptions): Promise<VoxelCore> {
  const userText = [
    purpose === "avatar" ? "Current avatar core:" : "Current object core:",
    JSON.stringify(currentCore),
    "",
    `Change request: ${changePrompt}`,
  ].join("\n");
  const systemPrompt =
    purpose === "avatar" ? avatarSystemPrompt : voxelEditSystemPrompt;
  return requestVoxelCore(call, systemPrompt, userText);
}

async function requestVoxelCore(
  { apiKey, fetchImpl, model, temperature, timeoutMs }: GeminiCallOptions,
  systemPrompt: string,
  userText: string,
): Promise<VoxelCore> {
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
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userText }],
          },
        ],
        // JSON mode without a strict responseSchema: the voxel op discriminated
        // union can't be expressed in Gemini's responseSchema subset, so the schema
        // lives in the system prompt and we validate the result with zod below.
        generationConfig: {
          // Voxel specs with many ops are large; a low cap truncates the JSON.
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          temperature,
          // gemini-2.5-flash is a thinking model — turn on dynamic thinking
          thinkingConfig: { thinkingBudget: -1 },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response
      .json()
      .catch(() => null)) as GeminiGenerateContentResponse | null;

    if (!response.ok) {
      throw new AiWorkerError(
        "generation_failed",
        payload?.error?.message ?? `Gemini HTTP ${response.status}`,
      );
    }

    const candidate = payload?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = candidate?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (finishReason === "MAX_TOKENS") {
      throw new AiWorkerError(
        "validation_failed",
        "Gemini ran out of output tokens before finishing the object. Try a simpler object or retry.",
      );
    }
    if (!text) {
      throw new AiWorkerError(
        "validation_failed",
        "Gemini returned an empty voxel spec.",
      );
    }

    const raw = parseJsonObject(text);
    if (typeof (raw as Record<string, unknown>).rejection === "string") {
      throw new AiWorkerError(
        "invalid_prompt",
        (raw as Record<string, unknown>).rejection as string,
      );
    }
    const parsed = voxelCoreSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AiWorkerError(
        "validation_failed",
        parsed.error.issues[0]?.message ??
          "Gemini returned an invalid voxel spec.",
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiWorkerError(
        "timeout",
        `Gemini timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Reduces a stored VoxelBuilderSpec (the object's `source_spec_json`) to the creative
 * VoxelCore that the edit prompt operates on. Returns null if the spec is missing or
 * not a valid voxel spec (older/non-voxel objects can't be AI-edited).
 */
export function coreFromSourceSpec(
  sourceSpecJson: string | null | undefined,
): VoxelCore | null {
  if (!sourceSpecJson) return null;
  try {
    const spec = parseVoxelBuilderSpec(JSON.parse(sourceSpecJson));
    return {
      object_category: spec.object_category,
      size_tier: spec.size_tier,
      style_tags: spec.style_tags,
      behaviors: spec.behaviors,
      materials: spec.materials.map((material) => ({
        material_id: material.material_id,
        color_hint: material.color_hint,
        tags: material.tags,
      })),
      operations: spec.operations,
      quantity: 1,
    };
  } catch {
    return null;
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
      throw new AiWorkerError(
        "validation_failed",
        "Gemini response was not JSON.",
      );
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new AiWorkerError(
        "validation_failed",
        "Gemini response JSON could not be parsed.",
      );
    }
  }
}
