import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import barrelTriangleBuilder from "../fixtures/barrel-triangle.builder.json";
import pineTreeBuilder from "../fixtures/pine-tree.builder.json";
import pineTreeEditBuilder from "../fixtures/pine-tree-edit.builder.json";

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
      "Queue a create request, accept the AI draft into grace, move and scale it, then hand it into public/edit/cooldown flow.",
    sourcePrompt: "Add a pine tree to the left of the cabin.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_tree_1",
    objectId: "object_tree_1",
    graceSeconds: 12,
    draftBuilder: toBuilderSpec(pineTreeBuilder),
    editBuilder: toBuilderSpec(pineTreeEditBuilder),
  },
  barrel_grace: {
    key: "barrel_grace",
    label: "Barrel group grace",
    description:
      "Grouped create flow using authoritative builder-backed instances around the campfire anchor.",
    sourcePrompt: "Place three red barrels around the campfire.",
    creatorId: "player_1",
    rivalId: "player_2",
    jobId: "job_barrel_1",
    objectId: "object_barrels_1",
    graceSeconds: 8,
    draftBuilder: toBuilderSpec(barrelTriangleBuilder),
  },
};

export const scenarioCatalog = Object.values(scenarios).map((scenario) => ({
  key: scenario.key,
  label: scenario.label,
  description: scenario.description,
}));

function toBuilderSpec(value: unknown) {
  return value as BuilderSpec;
}
