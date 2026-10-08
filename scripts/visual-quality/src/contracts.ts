import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";
import { z } from "zod";

// File formats for the offline visual-quality harness. Inputs that humans
// author (datasets, labels) get zod schemas; records the harness writes itself
// are plain types tagged with a format version.

export const DIMENSIONS = [
  "recognizability",
  "attribute_fidelity",
  "visual_coherence",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const SPLITS = ["development", "holdout", "unassigned"] as const;
export type Split = (typeof SPLITS)[number];

export const SUPPORTED_SAMPLE_TYPE = "single_object_create";

// ---------------------------------------------------------------------------
// Dataset manifest (evals/visual-quality/**/manifest.json, imports)

export const DATASET_FORMAT = "vq-dataset/v1";

export const datasetEnvelopeSchema = z.object({
  format: z.literal(DATASET_FORMAT),
  dataset_id: z.string().min(1),
  description: z.string().optional(),
  // Samples are validated one at a time so a bad entry doesn't hide the rest.
  samples: z.array(z.unknown()),
});

export const sampleIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,79}$/i,
    "must be 1-80 chars of letters, digits, '.', '_' or '-' (it is used as a directory name)",
  );

export const generatorSchema = z
  .object({
    model_id: z.string().min(1).nullable().optional(),
    prompt_version: z.string().min(1).nullable().optional(),
  })
  .strict();

export const provenanceSchema = z
  .object({
    kind: z.enum(["curated_fixture", "feedback_export"]),
    note: z.string().optional(),
    // Player thumbs up/down from object_feedback: a supporting signal only.
    player_rating: z.enum(["up", "down"]).optional(),
    // Feedback imports must be reviewed for personal information before any
    // external evaluation. Curated fixtures are authored in-repo.
    privacy_reviewed: z.boolean().optional(),
  })
  .strict();

// Strict: unknown keys (including any player identifiers) are rejected rather
// than silently carried into evaluation artifacts.
export const datasetSampleSchema = z
  .object({
    sample_id: sampleIdSchema,
    prompt_family_id: z.string().min(1),
    split: z.enum(SPLITS),
    sample_type: z.string().min(1),
    prompt: z.string().trim().min(1).max(1_000),
    builder_spec: z.unknown().optional(),
    builder_spec_path: z.string().min(1).optional(),
    source_spec: z.unknown().optional(),
    source_spec_path: z.string().min(1).optional(),
    // Explicit single-object evidence when the source spec can't provide it.
    quantity: z.number().int().min(1).nullable().optional(),
    generator: generatorSchema.optional(),
    provenance: provenanceSchema,
    // Human-authored: does the prompt request explicit visual attributes
    // (colors, materials, parts, proportions)? null = not yet curated.
    visual_attributes_applicable: z.boolean().nullable(),
    tags: z.array(z.string()).optional(),
    // Fixture self-test metadata; ignored by evaluation.
    fixture_expectation: z.string().optional(),
  })
  .strict();

export type DatasetSample = z.infer<typeof datasetSampleSchema>;

export interface ValidatedSample {
  sample_id: string;
  prompt_family_id: string;
  split: Split;
  prompt: string;
  builder_spec: BuilderSpec;
  source_spec: unknown;
  quantity: 1;
  generator: { model_id: string | null; prompt_version: string | null };
  provenance: z.infer<typeof provenanceSchema>;
  visual_attributes_applicable: boolean;
  tags: string[];
  // sha256 of the canonical builder spec JSON: the rendered artifact identity.
  artifact_sha256: string;
}

// Why a sample can't be evaluated. Kept distinct so reports never mix harness
// data problems with generator failures:
// - malformed: the input file/spec doesn't match the contract.
// - unsupported: well-formed but outside v1 scope (edits, avatars, quantity > 1).
// - needs_curation: a human decision is missing (scope, attributes, privacy).
// - artifact_failure: the generator produced nothing renderable (empty geometry).
export type InputIssue =
  | "malformed"
  | "unsupported"
  | "needs_curation"
  | "artifact_failure";

// Whatever identifying metadata could be read from an invalid sample.
export interface SampleMeta {
  sample_id: string;
  prompt_family_id: string | null;
  split: Split | null;
  prompt: string | null;
  generator: { model_id: string | null; prompt_version: string | null };
  provenance_kind: string | null;
}

export type SampleValidation =
  | { status: "valid"; sample: ValidatedSample; warnings: string[] }
  | {
      status: "input_invalid";
      issue: InputIssue;
      reasons: string[];
      meta: SampleMeta;
    };

// ---------------------------------------------------------------------------
// Capture records (written by the capture runner)

export const CAPTURE_FORMAT = "vq-capture/v1";

export const VIEW_IDS = [
  "front_three_quarter",
  "opposite_three_quarter",
  "elevated",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type Vec3 = [number, number, number];

export interface ViewStats {
  // Fraction of pixels that differ from the background colour.
  foreground_fraction: number;
  // Normalised [0,1] bounding box of foreground pixels, or null when blank.
  foreground_bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  // Foreground pixel counts by hue bucket, for colour regression checks.
  hue_histogram: Record<string, number>;
}

export interface CapturedView {
  view_id: ViewId;
  label: string;
  file: string;
  sha256: string;
  camera: {
    position: Vec3;
    target: Vec3;
    up: Vec3;
    fov_degrees: number;
    near: number;
    far: number;
  };
  stats: ViewStats;
}

export interface CaptureRecord {
  format: typeof CAPTURE_FORMAT;
  sample_id: string;
  status: "captured" | "capture_failed";
  error: string | null;
  cache_key: string;
  reused_from: string | null;
  artifact_sha256: string;
  renderer: {
    capture_version: string;
    capture_app_sha256: string;
    three_revision: string;
  };
  settings: CaptureSettings;
  browser: { version: string; gl_renderer: string | null } | null;
  bounds: { min: Vec3; max: Vec3; size: Vec3 } | null;
  views: CapturedView[];
  browser_errors: string[];
  capture_latency_ms: number;
  captured_at: string;
}

export interface CaptureSettings {
  width: number;
  height: number;
  device_pixel_ratio: number;
  background: string;
  tone_mapping: string;
  tone_mapping_exposure: number;
  output_color_space: string;
  fov_degrees: number;
  framing_padding: number;
  // Fraction of foreground pixels below which a view counts as blank.
  blank_threshold: number;
  timeout_ms: number;
  gl_backend: string;
}

// ---------------------------------------------------------------------------
// Judgments (written by the judge runner)

export const JUDGMENT_FORMAT = "vq-judgment/v1";

export type JudgeStatus = "completed" | "refused" | "incomplete" | "api_error";

export interface ScoreProbability {
  value: number;
  label: string;
  probability: number;
}

export type QuestionOutcome =
  | {
      state: "answered";
      score: number;
      confidence: number;
      probabilities: ScoreProbability[];
    }
  | { state: "refused" }
  | { state: "missing" }
  | { state: "invalid"; reason: string }
  | { state: "not_applicable" };

export interface JudgeAttempt {
  started_at: string;
  duration_ms: number;
  http_status: number | null;
  error: string | null;
  transient: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface JudgmentRecord {
  format: typeof JUDGMENT_FORMAT;
  sample_id: string;
  trial: number;
  status: JudgeStatus;
  error: string | null;
  cache_key: string;
  reused_from: string | null;
  judge: { model: string; request_format: string; image_detail: string; mock: boolean };
  rubric: { version: string; sha256: string };
  questions: Record<Dimension, QuestionOutcome>;
  response_model: string | null;
  usage: Usage | null;
  estimated_cost_usd: number | null;
  attempts: JudgeAttempt[];
  judge_latency_ms: number;
  evaluated_at: string;
}

// ---------------------------------------------------------------------------
// Human labels (evals/visual-quality/labels/*.json, or private under .tmp)

export const LABELS_FORMAT = "vq-labels/v1";

const levelSchema = z.number().int().min(0).max(3);

export const humanLabelSchema = z
  .object({
    sample_id: sampleIdSchema.optional(),
    blind_id: z.string().optional(),
    reviewer_id: z.string().min(1),
    recognizability: levelSchema,
    attribute_fidelity: z.union([levelSchema, z.literal("not_applicable")]),
    visual_coherence: levelSchema,
    notes: z.string().max(4_000).optional(),
  })
  .strict()
  .refine((label) => (label.sample_id === undefined) !== (label.blind_id === undefined), {
    message: "exactly one of sample_id or blind_id is required",
  });

export const labelFileSchema = z.object({
  format: z.literal(LABELS_FORMAT),
  rubric_version: z.string().optional(),
  labels: z.array(humanLabelSchema),
});

export type HumanLabel = z.infer<typeof humanLabelSchema>;
export type LabelFile = z.infer<typeof labelFileSchema>;

// ---------------------------------------------------------------------------
// Run manifest (.tmp/visual-quality/runs/<run-id>/run.json)

export const RUN_FORMAT = "vq-run/v1";

export interface RunStep {
  command: string;
  started_at: string;
  finished_at: string;
  options: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export interface RunManifest {
  format: typeof RUN_FORMAT;
  run_id: string;
  created_at: string;
  dataset: { path: string; dataset_id: string; sha256: string; sample_count: number };
  git: { commit: string | null; dirty: boolean | null };
  environment: { node: string; platform: string };
  steps: RunStep[];
}
