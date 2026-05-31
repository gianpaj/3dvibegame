import type { BuilderSpec, VoxelBuilderSpec } from "@3dvibegame/scene-authority-ts";

import { resolveScenarioFromPrompt, scenarios, type ScenarioActionId } from "../fixtures/scenarios";

export interface AiWorkerArtifact {
  sourceSpec: VoxelBuilderSpec;
  builderSpec: BuilderSpec;
  sourceSpecJson: string;
  builderSpecJson: string;
}

export interface AiWorkerDraftResult extends AiWorkerArtifact {
  jobIdBase: string;
  objectIdBase: string;
}

export interface AiWorkerClient {
  createDraft(input: { prompt: string }): Promise<AiWorkerDraftResult>;
  createEdit(input: {
    actionId: ScenarioActionId;
    baseObjectId: string;
    baseVersion: number;
  }): Promise<AiWorkerArtifact>;
}

export function createFixtureAiWorkerClient(): AiWorkerClient {
  return {
    async createDraft({ prompt }) {
      const scenario = resolveScenarioFromPrompt(prompt);
      return {
        jobIdBase: scenario.jobId,
        objectIdBase: scenario.objectId,
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
  };
}
