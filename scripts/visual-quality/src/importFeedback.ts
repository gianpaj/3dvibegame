import { sha256 } from "./canonical.ts";
import { DATASET_FORMAT, SUPPORTED_SAMPLE_TYPE } from "./contracts.ts";

// Converts exported object_feedback rows into a dataset manifest for manual
// curation. Output fields are built from an allow-list: player identity,
// nickname, world/object IDs, operation IDs and timestamps never pass through.
// Imported samples always need curation (scope, attributes, privacy review,
// split assignment) before they can be captured or judged.

export interface ImportResult {
  manifest: {
    format: typeof DATASET_FORMAT;
    dataset_id: string;
    description: string;
    samples: Record<string, unknown>[];
  };
  // Row index + reason only; excluded rows carry no prompt or identity.
  excluded: Array<{ row: number; reason: string }>;
  // Sample IDs whose prompt matched a personal-information heuristic.
  privacy_flags: Array<{ sample_id: string; matches: string[] }>;
}

const PII_PATTERNS: Array<[string, RegExp]> = [
  ["email address", /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ["phone number", /\+?\d[\d\s().-]{7,}\d/],
  ["URL", /\bhttps?:\/\/|\bwww\./i],
  ["@handle", /(^|\s)@[a-z0-9_]{2,}/i],
];

export function importFeedbackRows(rows: unknown[], datasetId: string): ImportResult {
  const samples: Record<string, unknown>[] = [];
  const excluded: ImportResult["excluded"] = [];
  const privacy_flags: ImportResult["privacy_flags"] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      excluded.push({ row: index, reason: "row is not an object" });
      return;
    }
    const field = fieldReader(row as Record<string, unknown>);
    const operation = field("operation");
    if (operation === "edit") {
      excluded.push({
        row: index,
        reason: "edit record: feedback has no before-spec snapshot, so edit preservation can't be evaluated",
      });
      return;
    }
    if (operation !== "create") {
      excluded.push({ row: index, reason: `unsupported operation ${JSON.stringify(operation ?? null)}` });
      return;
    }
    const prompt = field("source_prompt")?.trim();
    if (!prompt) {
      excluded.push({ row: index, reason: "missing source_prompt" });
      return;
    }
    const builderSpec = parseJsonField(field("builder_spec_json"));
    if (!builderSpec.ok) {
      excluded.push({ row: index, reason: `builder_spec_json ${builderSpec.error}` });
      return;
    }
    const sourceSpec = parseJsonField(field("source_spec_json"));

    // Opaque, stable ID: a hash of the operation ID (which embeds a timestamp)
    // or of the content when the operation ID is absent.
    const identity = field("operation_id") ?? `${prompt}\u0000${field("builder_spec_json")}`;
    const sampleId = `fb-${sha256(identity).slice(0, 12)}`;
    if (seen.has(sampleId)) {
      excluded.push({ row: index, reason: "duplicate of an earlier row" });
      return;
    }
    seen.add(sampleId);

    const rating = field("rating");
    const sample: Record<string, unknown> = {
      sample_id: sampleId,
      prompt_family_id: "unassigned",
      split: "unassigned",
      sample_type: SUPPORTED_SAMPLE_TYPE,
      prompt,
      builder_spec: builderSpec.value,
      // object_feedback stores the compiled VoxelBuilderSpec, which has no
      // quantity; leave scope for a human to confirm.
      quantity: null,
      generator: {
        model_id: field("model_id") ?? null,
        prompt_version: field("prompt_version") ?? null,
      },
      provenance: {
        kind: "feedback_export",
        ...(rating === "up" || rating === "down" ? { player_rating: rating } : {}),
        privacy_reviewed: false,
      },
      visual_attributes_applicable: null,
    };
    if (sourceSpec.ok) sample.source_spec = sourceSpec.value;
    samples.push(sample);

    const matches = PII_PATTERNS.filter(([, pattern]) => pattern.test(prompt)).map(([name]) => name);
    if (matches.length) privacy_flags.push({ sample_id: sampleId, matches });
  });

  return {
    manifest: {
      format: DATASET_FORMAT,
      dataset_id: datasetId,
      description:
        "Imported from object_feedback. Curate before use: set quantity, " +
        "visual_attributes_applicable, prompt_family_id, split and privacy_reviewed.",
      samples,
    },
    excluded,
    privacy_flags,
  };
}

// Accepts snake_case (SQL export) or camelCase (SDK row) column names.
function fieldReader(row: Record<string, unknown>) {
  return (snake: string): string | undefined => {
    const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const value = row[snake] ?? row[camel];
    return typeof value === "string" ? value : undefined;
  };
}

function parseJsonField(text: string | undefined): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text === undefined) return { ok: false, error: "is missing" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "is not valid JSON" };
  }
}
