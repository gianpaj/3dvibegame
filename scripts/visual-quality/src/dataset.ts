import { readFileSync } from "node:fs";
import path from "node:path";

import { builderSpecSchema, type BuilderSpec } from "@3dvibegame/scene-authority-ts";
import type { z } from "zod";

import { hashJson, sha256 } from "./canonical.ts";
import {
  datasetEnvelopeSchema,
  datasetSampleSchema,
  SUPPORTED_SAMPLE_TYPE,
  type DatasetSample,
  type InputIssue,
  type SampleMeta,
  type SampleValidation,
  type ValidatedSample,
} from "./contracts.ts";

export type JsonReader = (relativePath: string) => { ok: true; value: unknown } | { ok: false; error: string };

export interface LoadedDataset {
  path: string;
  dataset_id: string;
  sha256: string;
  validations: SampleValidation[];
}

export function loadDataset(manifestPath: string): LoadedDataset {
  const text = readFileSync(manifestPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${manifestPath}: not valid JSON (${(error as Error).message})`);
  }
  const envelope = datasetEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new Error(`${manifestPath}: ${formatIssues(envelope.error.issues).join("; ")}`);
  }
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const validations = validateDataset(envelope.data.samples, fileJsonReader(manifestDir));
  // The dataset hash covers referenced spec files too, so editing a spec file
  // changes the recorded dataset identity.
  const contentHash = hashJson({
    manifest: sha256(text),
    artifacts: validations.map((v) =>
      v.status === "valid" ? v.sample.artifact_sha256 : `${v.meta.sample_id}:${v.issue}`,
    ),
  });
  return {
    path: manifestPath,
    dataset_id: envelope.data.dataset_id,
    sha256: contentHash,
    validations,
  };
}

// Reads spec files relative to the manifest, refusing paths that escape its
// directory.
export function fileJsonReader(baseDir: string): JsonReader {
  return (relativePath) => {
    const resolved = path.resolve(baseDir, relativePath);
    if (!resolved.startsWith(baseDir + path.sep)) {
      return { ok: false, error: `${relativePath}: path escapes the manifest directory` };
    }
    try {
      return { ok: true, value: JSON.parse(readFileSync(resolved, "utf8")) };
    } catch (error) {
      return { ok: false, error: `${relativePath}: ${(error as Error).message}` };
    }
  };
}

export function validateDataset(rawSamples: unknown[], readJson: JsonReader): SampleValidation[] {
  const validations = rawSamples.map((raw, index) => validateSample(raw, readJson, index));

  // Duplicate IDs would collide in run directories and label joins. Compare
  // case-insensitively: "Pine" and "pine" share a directory on macOS.
  const idCounts = new Map<string, number>();
  for (const v of validations) {
    const id = (v.status === "valid" ? v.sample.sample_id : v.meta.sample_id).toLowerCase();
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  // A prompt family in both development and holdout leaks near-duplicates
  // across the split.
  const familySplits = new Map<string, Set<string>>();
  for (const v of validations) {
    const family = v.status === "valid" ? v.sample.prompt_family_id : v.meta.prompt_family_id;
    const split = v.status === "valid" ? v.sample.split : v.meta.split;
    if (!family || !split || split === "unassigned") continue;
    if (!familySplits.has(family)) familySplits.set(family, new Set());
    familySplits.get(family)!.add(split);
  }

  return validations.map((v) => {
    const id = v.status === "valid" ? v.sample.sample_id : v.meta.sample_id;
    const family = v.status === "valid" ? v.sample.prompt_family_id : v.meta.prompt_family_id;
    const reasons: string[] = [];
    if ((idCounts.get(id.toLowerCase()) ?? 0) > 1) reasons.push(`duplicate sample_id "${id}" (IDs are case-insensitive)`);
    if (family && (familySplits.get(family)?.size ?? 0) > 1) {
      reasons.push(`prompt family "${family}" appears in both development and holdout`);
    }
    if (!reasons.length) return v;
    if (v.status === "valid") {
      return { status: "input_invalid", issue: "malformed", reasons, meta: metaFromValid(v.sample) };
    }
    return { ...v, issue: "malformed", reasons: [...reasons, ...v.reasons] };
  });
}

export function validateSample(raw: unknown, readJson: JsonReader, index = 0): SampleValidation {
  const parsed = datasetSampleSchema.safeParse(raw);
  if (!parsed.success) {
    return invalid("malformed", formatIssues(parsed.error.issues), metaFromRaw(raw, index));
  }
  const sample = parsed.data;
  const meta = metaFromSample(sample);

  const spec = resolveEmbedded(sample.builder_spec, sample.builder_spec_path, "builder_spec", readJson, true);
  if (!spec.ok) return invalid("malformed", [spec.error], meta);
  const source = resolveEmbedded(sample.source_spec, sample.source_spec_path, "source_spec", readJson, false);
  if (!source.ok) return invalid("malformed", [source.error], meta);

  if (sample.sample_type !== SUPPORTED_SAMPLE_TYPE) {
    return invalid(
      "unsupported",
      [`sample_type "${sample.sample_type}" is out of scope; v1 evaluates only "${SUPPORTED_SAMPLE_TYPE}"`],
      meta,
    );
  }

  const specResult = builderSpecSchema.safeParse(spec.value);
  if (!specResult.success) {
    return invalid(
      "malformed",
      formatIssues(specResult.error.issues).map((issue) => `builder_spec ${issue}`),
      meta,
    );
  }
  // Render the stored spec as-is; the schema only vouches for its shape.
  const builderSpec = spec.value as BuilderSpec;

  if (builderSpec.operation !== "create") {
    return invalid(
      "unsupported",
      [`builder_spec.operation "${builderSpec.operation}" is an edit; edit evaluation is out of scope`],
      meta,
    );
  }

  const geometryReasons = negativeGeometry(builderSpec);
  if (geometryReasons.length) return invalid("malformed", geometryReasons, meta);

  const quantity = establishQuantity(sample.quantity ?? null, source.value);
  if (quantity.kind === "conflict") return invalid("malformed", [quantity.reason], meta);
  if (quantity.kind === "multiple") {
    return invalid(
      "unsupported",
      [`quantity ${quantity.value} means a multi-object request; v1 evaluates single objects only`],
      meta,
    );
  }

  const curation: string[] = [];
  if (quantity.kind === "unknown") {
    curation.push(
      "single-object scope not established: add quantity: 1 after confirming the request was for one object",
    );
  }
  if (sample.visual_attributes_applicable === null) {
    curation.push("visual_attributes_applicable must be set by a human reviewer");
  }
  if (sample.provenance.kind === "feedback_export" && sample.provenance.privacy_reviewed !== true) {
    curation.push("feedback import needs a personal-information review (set provenance.privacy_reviewed: true)");
  }
  if (curation.length) return invalid("needs_curation", curation, meta);

  const emptyReason = emptyGeometry(builderSpec);
  if (emptyReason) return invalid("artifact_failure", [emptyReason], meta);

  const warnings: string[] = [];
  if (sample.split === "unassigned") {
    warnings.push("split is unassigned; the sample is excluded from calibration metrics");
  }

  return {
    status: "valid",
    warnings,
    sample: {
      sample_id: sample.sample_id,
      prompt_family_id: sample.prompt_family_id,
      split: sample.split,
      prompt: sample.prompt,
      builder_spec: builderSpec,
      source_spec: source.value ?? null,
      quantity: 1,
      generator: meta.generator,
      provenance: sample.provenance,
      visual_attributes_applicable: sample.visual_attributes_applicable as boolean,
      tags: sample.tags ?? [],
      artifact_sha256: hashJson(builderSpec),
    },
  };
}

type Quantity =
  | { kind: "single" }
  | { kind: "multiple"; value: number }
  | { kind: "unknown" }
  | { kind: "conflict"; reason: string };

// Single-object scope needs evidence: explicit manifest metadata, a quantity on
// the source spec, or a raw voxel core (where an absent quantity means 1).
// A compiled VoxelBuilderSpec (what object_feedback stores) drops quantity, so
// it proves nothing either way.
export function establishQuantity(manifestQuantity: number | null, sourceSpec: unknown): Quantity {
  const sourceQuantity = quantityFromSourceSpec(sourceSpec);
  if (manifestQuantity !== null && sourceQuantity !== null && manifestQuantity !== sourceQuantity) {
    return {
      kind: "conflict",
      reason: `manifest quantity ${manifestQuantity} conflicts with source spec quantity ${sourceQuantity}`,
    };
  }
  const value = manifestQuantity ?? sourceQuantity;
  if (value === null) return { kind: "unknown" };
  return value === 1 ? { kind: "single" } : { kind: "multiple", value };
}

function quantityFromSourceSpec(sourceSpec: unknown): number | null {
  if (!sourceSpec || typeof sourceSpec !== "object") return null;
  const record = sourceSpec as Record<string, unknown>;
  if (typeof record.quantity === "number") return record.quantity;
  const isVoxelCore = Array.isArray(record.operations) && !("spec_version" in record);
  return isVoxelCore ? 1 : null;
}

function negativeGeometry(spec: BuilderSpec): string[] {
  const reasons: string[] = [];
  spec.parts.forEach((part, index) => {
    if (part.dimensions.some((d) => d < 0)) {
      reasons.push(`builder_spec parts[${index}] (${part.part_id}) has a negative dimension`);
    }
  });
  return reasons;
}

function emptyGeometry(spec: BuilderSpec): string | null {
  if (spec.parts.length === 0) return "builder_spec has no parts (empty geometry)";
  if (spec.instances.length === 0) return "builder_spec has no instances (nothing is placed)";
  const visible = spec.parts.some(
    (part) =>
      part.dimensions.every((d) => d > 0) && (part.local_scale ?? [1, 1, 1]).every((s) => s !== 0),
  );
  return visible ? null : "every builder_spec part has zero volume (empty geometry)";
}

function resolveEmbedded(
  inline: unknown,
  filePath: string | undefined,
  field: string,
  readJson: JsonReader,
  required: boolean,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (inline !== undefined && filePath !== undefined) {
    return { ok: false, error: `set only one of ${field} or ${field}_path` };
  }
  if (filePath !== undefined) return readJson(filePath);
  if (inline === undefined && required) {
    return { ok: false, error: `${field} or ${field}_path is required` };
  }
  return { ok: true, value: inline };
}

function invalid(issue: InputIssue, reasons: string[], meta: SampleMeta): SampleValidation {
  return { status: "input_invalid", issue, reasons, meta };
}

function metaFromSample(sample: DatasetSample): SampleMeta {
  return {
    sample_id: sample.sample_id,
    prompt_family_id: sample.prompt_family_id,
    split: sample.split,
    prompt: sample.prompt,
    generator: {
      model_id: sample.generator?.model_id ?? null,
      prompt_version: sample.generator?.prompt_version ?? null,
    },
    provenance_kind: sample.provenance.kind,
  };
}

function metaFromValid(sample: ValidatedSample): SampleMeta {
  return {
    sample_id: sample.sample_id,
    prompt_family_id: sample.prompt_family_id,
    split: sample.split,
    prompt: sample.prompt,
    generator: sample.generator,
    provenance_kind: sample.provenance.kind,
  };
}

// Best-effort metadata from an entry that failed the schema, so the report can
// still name it.
function metaFromRaw(raw: unknown, index: number): SampleMeta {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  const id = str(record.sample_id);
  return {
    sample_id: id && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id) ? id : `invalid-entry-${index}`,
    prompt_family_id: str(record.prompt_family_id),
    split: (["development", "holdout", "unassigned"] as const).find((s) => s === record.split) ?? null,
    prompt: str(record.prompt),
    generator: { model_id: null, prompt_version: null },
    provenance_kind: null,
  };
}

export function formatIssues(issues: z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
}
