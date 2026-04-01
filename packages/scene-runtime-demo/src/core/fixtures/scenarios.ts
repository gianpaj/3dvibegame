import {
  compileVoxelBuilderSpec,
  parseVoxelBuilderSpec,
  type BuilderSpec,
  type GenerationIntent,
  type VoxelBuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import barrelTriangleVoxel from "../../fixtures/barrel-triangle.voxel-builder.json";
import pineTreeVoxel from "../../fixtures/pine-tree.voxel-builder.json";
import pineTreeEditVoxel from "../../fixtures/pine-tree-edit.voxel-builder.json";

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
  editBuilder?: BuilderSpec;
  plannedIntent: GenerationIntent;
}

export type ScenarioKey = "pine_lifecycle" | "barrel_grace";

export const scenarios: Record<ScenarioKey, LifecycleScenario> = {
  pine_lifecycle: {
    key: "pine_lifecycle",
    label: "Pine tree lifecycle",
    description:
      "Queue a create request, compile a voxel-native tree draft into the current BuilderSpec runtime shape, then hand it into public/edit/cooldown flow.",
    keywords: ["pine", "tree", "cabin", "forest"],
    sourcePrompt: "Add a pine tree to the left of the cabin.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_tree_1",
    objectId: "object_tree_1",
    graceSeconds: 12,
    voxelSource: parseVoxelBuilderSpec(pineTreeVoxel),
    draftBuilder: toBuilderSpec(pineTreeVoxel),
    editBuilder: toBuilderSpec(pineTreeEditVoxel),
    plannedIntent: toIntent(
      "Add a pine tree to the left of the cabin.",
      parseVoxelBuilderSpec(pineTreeVoxel),
      "Tree-sized foliage object anchored relative to the cabin for quick world dressing.",
    ),
  },
  barrel_grace: {
    key: "barrel_grace",
    label: "Barrel group grace",
    description:
      "Grouped create flow compiled from a voxel source fixture, including radial clone layout around the campfire anchor.",
    keywords: ["barrel", "barrels", "campfire", "fire"],
    sourcePrompt: "Place three red barrels around the campfire.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_barrel_1",
    objectId: "object_barrels_1",
    graceSeconds: 8,
    voxelSource: parseVoxelBuilderSpec(barrelTriangleVoxel),
    draftBuilder: toBuilderSpec(barrelTriangleVoxel),
    plannedIntent: toIntent(
      "Place three red barrels around the campfire.",
      parseVoxelBuilderSpec(barrelTriangleVoxel),
      "Small prop cluster placed around an existing world anchor using a repeat layout.",
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
  return ranked[0]?.score ? ranked[0].scenario : scenarios.pine_lifecycle;
}
