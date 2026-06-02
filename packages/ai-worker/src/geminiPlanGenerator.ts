import { google } from "@ai-sdk/google";
import { generateText, Output, type LanguageModel } from "ai";

import {
  createPlanSystemPrompt,
  createPlanSchema,
  type CreatePlanGenerator,
} from "./contracts.ts";

export interface GeminiPlanGeneratorConfig {
  model?: string;
  /** Override the language model (e.g. a MockLanguageModelV3 in tests). */
  languageModel?: LanguageModel;
  temperature?: number;
}

export function createGeminiPlanGenerator({
  model = process.env.AI_WORKER_MODEL ?? "gemini-2.5-flash",
  languageModel,
  temperature = 0.25,
}: GeminiPlanGeneratorConfig = {}): CreatePlanGenerator {
  const resolvedModel = languageModel ?? google(model);
  return {
    async generateCreatePlan({ sourcePrompt, signal }) {
      const { output, warnings } = await generateText({
        model: resolvedModel,
        abortSignal: signal,
        maxOutputTokens: 900,
        output: Output.object({ schema: createPlanSchema }),
        prompt: `Player prompt: ${sourcePrompt}`,
        system: createPlanSystemPrompt,
        temperature,
      });

      return {
        plan: output,
        warnings: warnings?.map(warningText) ?? [],
      };
    },
  };
}

function warningText(warning: unknown) {
  if (typeof warning === "object" && warning && "message" in warning) {
    return String(warning.message);
  }
  if (typeof warning === "object" && warning && "details" in warning) {
    return String(warning.details);
  }
  return JSON.stringify(warning);
}

export function createStaticPlanGenerator(): CreatePlanGenerator {
  return {
    async generateCreatePlan({ sourcePrompt }) {
      const normalized = sourcePrompt.toLowerCase();
      const treeish = normalized.includes("tree") || normalized.includes("forest");
      return {
        plan: {
          object_category: treeish ? "pine_tree" : "prompt_object",
          size_tier: treeish ? "medium" : "small",
          shape: treeish ? "tree" : "prop",
          palette: treeish ? "forest" : "magic",
          style_tags: treeish ? ["forest", "chunky", "soft_glow"] : ["chunky", "playful"],
          behaviors: [],
          key_features: treeish
            ? ["blocky trunk", "layered canopy", "small glow detail"]
            : ["solid silhouette", "single accent detail"],
        },
        warnings: ["static fake model adapter"],
      };
    },
  };
}
