import { parseVoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { AiWorkerError } from "./contracts";
import { voxelCoreSchema, type VoxelCore } from "./contracts";
import {
  avatarSystemPrompt,
  voxelBuilderSystemPrompt,
  voxelEditSystemPrompt,
} from "./contracts";

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

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
  usageMetadata?: GeminiUsageMetadata;
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

export interface GeminiVoxelResult {
  voxelCore: VoxelCore;
  usageMetadata: GeminiUsageMetadata | null;
}

/**
 * Calls Gemini to author the actual voxel geometry for a player prompt.
 * Works in both browser (BYOK) and Node.js (server-side key) contexts.
 */
export function generateVoxelCore({
  prompt,
  purpose = "object",
  ...call
}: GenerateVoxelCoreOptions): Promise<GeminiVoxelResult> {
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
}: GenerateVoxelEditOptions): Promise<GeminiVoxelResult> {
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
): Promise<GeminiVoxelResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
        generationConfig: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          temperature,
          thinkingConfig: { thinkingBudget: -1 },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response
      .json()
      .catch(() => null)) as GeminiGenerateContentResponse | null;

    if (!response.ok) {
      // Map Gemini's own quota/rate errors to rate_limited; everything else is generation_failed.
      const code = response.status === 429 ? "rate_limited" : "generation_failed";
      throw new AiWorkerError(
        code,
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
    return { voxelCore: parsed.data, usageMetadata: payload?.usageMetadata ?? null };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AiWorkerError(
        "timeout",
        `Gemini timed out after ${timeoutMs}ms`,
      );
    }
    // Node.js AbortError (not a DOMException)
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiWorkerError(
        "timeout",
        `Gemini timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
