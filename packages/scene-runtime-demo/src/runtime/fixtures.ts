import barrelTriangleArtifact from "../fixtures/barrel-triangle.artifact.json";
import clarificationArtifact from "../fixtures/clarification.artifact.json";
import pineTreeArtifact from "../fixtures/pine-tree.artifact.json";

export const fixtures = {
  barrel_triangle: {
    label: "Barrel triangle",
    description: "Grouped create action rendered around the campfire anchor.",
    artifact: barrelTriangleArtifact,
  },
  pine_tree: {
    label: "Pine tree",
    description: "Single object create rendered relative to the cabin anchor.",
    artifact: pineTreeArtifact,
  },
  clarification: {
    label: "Clarification",
    description: "Clarification flow with no draft geometry produced.",
    artifact: clarificationArtifact,
  },
} as const;

export type FixtureKey = keyof typeof fixtures;

export const fixtureCatalog = Object.entries(fixtures).map(([key, value]) => ({
  key: key as FixtureKey,
  label: value.label,
  description: value.description,
}));
