import {
  compileVoxelBuilderSpec,
  parseVoxelBuilderSpec,
  type BuilderSpec,
  type GenerationIntent,
  type VoxelBuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import avatarDraftVoxel from "../../fixtures/avatar-forest-guardian.voxel-builder.json";
import avatarOrnamentVoxel from "../../fixtures/avatar-forest-guardian-ornament.voxel-builder.json";
import avatarSilhouetteVoxel from "../../fixtures/avatar-forest-guardian-silhouette.voxel-builder.json";

export type ScenarioActionId = "refine_silhouette" | "add_ornament";

export interface RefineStep {
  actionId: ScenarioActionId;
  label: string;
  description: string;
  voxelSource: VoxelBuilderSpec;
  builderSpec: BuilderSpec;
}

export interface LifecycleScenario {
  key: ScenarioKey;
  label: string;
  description: string;
  keywords: string[];
  sourcePrompt: string;
  creatorId: string;
  rivalId: string;
  jobId: string;
  objectId: string;
  graceSeconds: number;
  voxelSource: VoxelBuilderSpec;
  draftBuilder: BuilderSpec;
  refineSteps: RefineStep[];
  plannedIntent: GenerationIntent;
}

export type ScenarioKey = "avatar_forge";

const avatarDraftSpec = parseVoxelBuilderSpec(avatarDraftVoxel);
const avatarSilhouetteSpec = parseVoxelBuilderSpec(avatarSilhouetteVoxel);
const avatarOrnamentSpec = parseVoxelBuilderSpec(avatarOrnamentVoxel);

export const scenarios: Record<ScenarioKey, LifecycleScenario> = {
  avatar_forge: {
    key: "avatar_forge",
    label: "Forest guardian avatar",
    description:
      "Prompt-driven avatar creation page for the logged-in player, with staged draft generation, fixture-backed refine submission, version bumps, and immediate cooldown return.",
    keywords: [
      "avatar",
      "guardian",
      "forest",
      "mossy",
      "rune",
      "player",
      "hero",
      "character",
    ],
    sourcePrompt:
      "Create a mossy forest guardian avatar with broad shoulders and a glowing chest rune.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_avatar_guardian_1",
    objectId: "player_avatar_slot",
    graceSeconds: 2,
    voxelSource: avatarDraftSpec,
    draftBuilder: toBuilderSpec(avatarDraftVoxel),
    refineSteps: [
      {
        actionId: "refine_silhouette",
        label: "Refine silhouette",
        description: "Broaden the stance and shoulders to make the avatar read more heroic.",
        voxelSource: avatarSilhouetteSpec,
        builderSpec: toBuilderSpec(avatarSilhouetteVoxel),
      },
      {
        actionId: "add_ornament",
        label: "Add ornament",
        description: "Add a luminous chest rune and shoulder ornaments for a stronger identity.",
        voxelSource: avatarOrnamentSpec,
        builderSpec: toBuilderSpec(avatarOrnamentVoxel),
      },
    ],
    plannedIntent: toIntent(
      "Create a mossy forest guardian avatar with broad shoulders and a glowing chest rune.",
      avatarDraftSpec,
      "Player-owned avatar draft built for an isolated editor preview rather than a world placement flow.",
    ),
  },
};

export const scenarioCatalog = Object.values(scenarios).map((scenario) => ({
  key: scenario.key,
  label: scenario.label,
  description: scenario.description,
  sourcePrompt: scenario.sourcePrompt,
}));

function toBuilderSpec(value: unknown) {
  return compileVoxelBuilderSpec(parseVoxelBuilderSpec(value)) as BuilderSpec;
}

function toIntent(
  sourcePrompt: string,
  spec: VoxelBuilderSpec,
  note: string,
): GenerationIntent {
  return {
    source_prompt: sourcePrompt,
    object_category: spec.object_category,
    size_tier: spec.size_tier,
    style_tags: [...spec.style_tags],
    behaviors: [...spec.behaviors],
    placement: {
      mode: spec.placement.mode,
      reference_object: spec.placement.reference_object ?? null,
      relation: spec.placement.relation ?? null,
      offset: [...spec.placement.offset],
    },
    notes: [note],
    conversation_context: null,
  };
}

export function resolveScenarioFromPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  const ranked = Object.values(scenarios).map((scenario) => ({
    scenario,
    score: scenario.keywords.reduce(
      (total, keyword) => total + (normalized.includes(keyword) ? 1 : 0),
      0,
    ),
  }));

  ranked.sort((left, right) => right.score - left.score);
  return ranked[0]?.score ? ranked[0].scenario : scenarios.avatar_forge;
}
