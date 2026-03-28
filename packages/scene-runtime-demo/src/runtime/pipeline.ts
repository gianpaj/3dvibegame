import {
  buildRenderDrafts,
  loadRuntimeTaskArtifact,
  normalizeResponse,
  summarizeArtifact,
  type ActionType,
  type NormalizedScenePlan,
  type PlanningRequest,
  type RenderDraftSpec,
  type RuntimeTaskArtifact,
  type ScenePlanningResponse,
} from "@3dvibegame/scene-runtime-ts";

import { fixtures, type FixtureKey } from "./fixtures";

type StageSource = "artifact" | "derived" | "missing";

const actionTypes: ActionType[] = [
  "add_object",
  "remove_object",
  "move_object",
  "rotate_object",
  "scale_object",
  "set_material",
  "set_color",
  "duplicate_object",
  "group_objects",
  "ungroup_objects",
  "replace_object",
  "set_relation",
  "clear_area",
  "spawn_layout",
  "annotate_constraint",
];

export interface PipelineSnapshot {
  fixtureKey: FixtureKey;
  fixtureLabel: string;
  fixtureDescription: string;
  artifact: RuntimeTaskArtifact;
  parsedResponse: ScenePlanningResponse | null;
  normalizedPlan: NormalizedScenePlan | null;
  normalizedPlanSource: StageSource;
  renderDrafts: RenderDraftSpec[];
  renderDraftSource: StageSource;
  warnings: string[];
  summary: ReturnType<typeof summarizeArtifact> & {
    renderDraftNodeCount: number;
    totalWarnings: number;
  };
}

export function buildPipelineSnapshot(key: FixtureKey): PipelineSnapshot {
  const fixture = fixtures[key];
  const artifact = loadRuntimeTaskArtifact(fixture.artifact);
  const parsedResponse = artifact.parsed_response ?? null;

  const normalizedPlanResult = resolveNormalizedPlan(artifact, parsedResponse);
  const renderDraftResult = resolveRenderDrafts(
    artifact,
    normalizedPlanResult.normalizedPlan,
  );

  const warnings = collectWarnings(
    artifact,
    normalizedPlanResult.normalizedPlan,
    renderDraftResult.renderDrafts,
  );
  const summary = summarizeArtifact(artifact);

  return {
    fixtureKey: key,
    fixtureLabel: fixture.label,
    fixtureDescription: fixture.description,
    artifact,
    parsedResponse,
    normalizedPlan: normalizedPlanResult.normalizedPlan,
    normalizedPlanSource: normalizedPlanResult.source,
    renderDrafts: renderDraftResult.renderDrafts,
    renderDraftSource: renderDraftResult.source,
    warnings,
    summary: {
      ...summary,
      renderDraftNodeCount: renderDraftResult.renderDrafts.reduce(
        (total, draft) => total + draft.primitive_nodes.length,
        0,
      ),
      totalWarnings: warnings.length,
    },
  };
}

function resolveNormalizedPlan(
  artifact: RuntimeTaskArtifact,
  parsedResponse: ScenePlanningResponse | null,
) {
  if (artifact.normalized_plan) {
    return { normalizedPlan: artifact.normalized_plan, source: "artifact" as const };
  }

  if (!parsedResponse) {
    return { normalizedPlan: null, source: "missing" as const };
  }

  return {
    normalizedPlan: normalizeResponse(buildSyntheticRequest(artifact), parsedResponse),
    source: "derived" as const,
  };
}

function resolveRenderDrafts(
  artifact: RuntimeTaskArtifact,
  normalizedPlan: NormalizedScenePlan | null,
) {
  if (
    artifact.render_drafts.length > 0 ||
    (normalizedPlan !== null && normalizedPlan.plan_kind !== "object_intent")
  ) {
    return { renderDrafts: artifact.render_drafts, source: "artifact" as const };
  }

  if (!normalizedPlan) {
    return { renderDrafts: [] satisfies RenderDraftSpec[], source: "missing" as const };
  }

  return {
    renderDrafts: buildRenderDrafts(normalizedPlan),
    source: "derived" as const,
  };
}

function collectWarnings(
  artifact: RuntimeTaskArtifact,
  normalizedPlan: NormalizedScenePlan | null,
  renderDrafts: RenderDraftSpec[],
) {
  return Array.from(
    new Set([
      ...artifact.diagnostics,
      ...(normalizedPlan?.diagnostics ?? []),
      ...renderDrafts.flatMap((draft) => draft.warnings),
    ]),
  );
}

function buildSyntheticRequest(artifact: RuntimeTaskArtifact): PlanningRequest {
  return {
    request_id: artifact.sample_id,
    scene: {
      scene_id: "fixture-scene",
      objects: [],
      allowed_catalog: {
        categories: [],
        action_types: actionTypes,
      },
    },
    user_prompt: artifact.task_id,
    system_prompt: "fixture replay",
    response_schema: {},
  };
}
