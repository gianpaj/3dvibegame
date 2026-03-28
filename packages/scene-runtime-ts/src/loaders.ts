import type { RuntimeTaskArtifact } from "./contracts";
import { parseRuntimeTaskArtifact } from "./guards";

export function loadRuntimeTaskArtifact(value: unknown): RuntimeTaskArtifact {
  return parseRuntimeTaskArtifact(value);
}

export function summarizeArtifact(artifact: RuntimeTaskArtifact) {
  return {
    sampleId: artifact.sample_id,
    taskId: artifact.task_id,
    responseType: artifact.parsed_response?.response_type ?? "unknown",
    normalizedIntentCount: artifact.normalized_plan?.intents.length ?? 0,
    groupedInstanceCount:
      artifact.normalized_plan?.intents.reduce(
        (total, intent) => total + (intent.instance_count ?? 1),
        0,
      ) ?? 0,
    renderDraftCount: artifact.render_drafts.length,
    diagnostics: artifact.diagnostics,
  };
}
