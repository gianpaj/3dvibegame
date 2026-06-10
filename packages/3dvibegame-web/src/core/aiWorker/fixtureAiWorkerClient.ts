import type { BuilderSpec, VoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { resolveScenarioFromPrompt, scenarios, type ScenarioActionId } from "../fixtures/scenarios";

export interface AiWorkerArtifact {
  sourceSpec: VoxelBuilderSpec;
  builderSpec: BuilderSpec;
  sourceSpecJson: string;
  builderSpecJson: string;
  /** The model that authored this result (e.g. "gemini-2.5-flash"); stamped onto feedback. */
  modelId: string;
  /**
   * Avatar-only rendered size multiplier the AI requested (1 = human height, up
   * to 4). Undefined means the AI said nothing about size — keep the current one.
   */
  avatarScale?: number;
}

export interface AiWorkerDraftResult extends AiWorkerArtifact {
  jobIdBase: string;
  objectIdBase: string;
  /** Number of independent objects the player asked for (1 = default). */
  quantity: number;
}

export interface AiWorkerClient {
  createDraft(input: {
    prompt: string;
    /** "avatar" selects the avatar system prompt (single grounded body); default "object". */
    purpose?: "object" | "avatar";
  }): Promise<AiWorkerDraftResult>;
  createEdit(input: {
    // Optional: scenario refine recipes use it; free-form chat edits omit it and rely
    // on `sourcePrompt` + `objectContext`.
    actionId?: ScenarioActionId;
    baseObjectId: string;
    baseVersion: number;
    sourcePrompt?: string;
    objectContext?: AiWorkerObjectContext | null;
    /** "avatar" selects the avatar system prompt (single grounded body); default "object". */
    purpose?: "object" | "avatar";
  }): Promise<AiWorkerArtifact>;
}

export interface AiWorkerObjectContext {
  objectId: string;
  version: number;
  sourceSpecJson?: string | null;
  builderSpecJson?: string | null;
}

export function createFixtureAiWorkerClient(): AiWorkerClient {
  return {
    async createDraft({ prompt }) {
      const scenario = resolveScenarioFromPrompt(prompt);
      return {
        jobIdBase: scenario.jobId,
        objectIdBase: scenario.objectId,
        quantity: 1,
        ...toArtifact(scenario.voxelSource, scenario.draftBuilder),
      };
    },
    async createEdit({ actionId }) {
      const refineStep = scenarios.avatar_forge.refineSteps.find(
        (step) => step.actionId === actionId,
      );
      if (!refineStep) {
        throw new Error("Fixture AI worker does not have that refine recipe.");
      }

      return toArtifact(refineStep.voxelSource, refineStep.builderSpec);
    },
  };
}

function toArtifact(sourceSpec: VoxelBuilderSpec, builderSpec: BuilderSpec): AiWorkerArtifact {
  return {
    sourceSpec,
    builderSpec,
    sourceSpecJson: JSON.stringify(sourceSpec),
    builderSpecJson: JSON.stringify(builderSpec),
    modelId: "fixture",
  };
}
