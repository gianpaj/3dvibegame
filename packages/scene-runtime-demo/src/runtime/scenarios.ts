import {
  compileVoxelBuilderSpec,
  parseVoxelBuilderSpec,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import barrelTriangleVoxel from "../fixtures/barrel-triangle.voxel-builder.json";
import pineTreeVoxel from "../fixtures/pine-tree.voxel-builder.json";
import pineTreeEditVoxel from "../fixtures/pine-tree-edit.voxel-builder.json";

export interface LifecycleScenario {
  key: ScenarioKey;
  label: string;
  description: string;
  sourcePrompt: string;
  creatorId: string;
  rivalId: string;
  jobId: string;
  objectId: string;
  graceSeconds: number;
  draftBuilder: BuilderSpec;
  editBuilder?: BuilderSpec;
}

export type ScenarioKey = "pine_lifecycle" | "barrel_grace";

export const scenarios: Record<ScenarioKey, LifecycleScenario> = {
  pine_lifecycle: {
    key: "pine_lifecycle",
    label: "Pine tree lifecycle",
    description:
      "Queue a create request, compile a voxel-native tree draft into the current BuilderSpec runtime shape, then hand it into public/edit/cooldown flow.",
    sourcePrompt: "Add a pine tree to the left of the cabin.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_tree_1",
    objectId: "object_tree_1",
    graceSeconds: 12,
    draftBuilder: toBuilderSpec(pineTreeVoxel),
    editBuilder: toBuilderSpec(pineTreeEditVoxel),
  },
  barrel_grace: {
    key: "barrel_grace",
    label: "Barrel group grace",
    description:
      "Grouped create flow compiled from a voxel source fixture, including radial clone layout around the campfire anchor.",
    sourcePrompt: "Place three red barrels around the campfire.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_barrel_1",
    objectId: "object_barrels_1",
    graceSeconds: 8,
    draftBuilder: toBuilderSpec(barrelTriangleVoxel),
  },
};

export const scenarioCatalog = Object.values(scenarios).map((scenario) => ({
  key: scenario.key,
  label: scenario.label,
  description: scenario.description,
}));

function toBuilderSpec(value: unknown) {
  return compileVoxelBuilderSpec(parseVoxelBuilderSpec(value)) as BuilderSpec;
}
