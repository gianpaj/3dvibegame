import {
  DIMENSIONS,
  type CaptureRecord,
  type Dimension,
  type InputIssue,
  type JudgmentRecord,
  type QuestionOutcome,
  type Split,
} from "../contracts.ts";
import { blindId, primaryLabel, type LoadedLabels, type ResolvedLabel } from "../labels.ts";
import { readCapture, readJudgments, readSamples } from "../run.ts";

// Every sample in the run gets exactly one status so coverage reports can
// account for failures instead of silently dropping them.
export type SampleStatus =
  | "input_invalid"
  | "capture_failed"
  | "not_captured"
  | "not_judged"
  | "api_error"
  | "refused"
  | "incomplete"
  | "completed";

export const SAMPLE_STATUSES: SampleStatus[] = [
  "completed",
  "incomplete",
  "refused",
  "api_error",
  "not_judged",
  "not_captured",
  "capture_failed",
  "input_invalid",
];

export interface SampleResult {
  sample_id: string;
  blind_id: string;
  prompt: string | null;
  prompt_family_id: string | null;
  split: Split | null;
  generator: { model_id: string | null; prompt_version: string | null };
  provenance_kind: string | null;
  player_rating: "up" | "down" | null;
  visual_attributes_applicable: boolean | null;
  status: SampleStatus;
  input_issue: InputIssue | null;
  // Validation reasons, capture error or judge error, whichever applies.
  reasons: string[];
  capture: CaptureRecord | null;
  // Trial 0 is the primary judgment; later trials feed repeatability.
  judgments: JudgmentRecord[];
  scores: Record<Dimension, QuestionOutcome | null>;
  human: { primary: ResolvedLabel | null; all: ResolvedLabel[] };
}

export function collectResults(runId: string, labels: LoadedLabels | null, primaryReviewer?: string): SampleResult[] {
  return readSamples(runId).map((validation): SampleResult => {
    const valid = validation.status === "valid" ? validation.sample : null;
    const meta = validation.status === "valid" ? null : validation.meta;
    const sampleId = valid?.sample_id ?? meta!.sample_id;
    const capture = valid ? readCapture(runId, sampleId) : null;
    const judgments = valid ? readJudgments(runId, sampleId) : [];
    const primary = judgments.find((j) => j.trial === 0) ?? null;
    const humanAll = labels?.bySample.get(sampleId) ?? [];

    let status: SampleStatus;
    let reasons: string[] = [];
    if (validation.status !== "valid") {
      status = "input_invalid";
      reasons = validation.reasons;
    } else if (!capture) {
      status = "not_captured";
    } else if (capture.status !== "captured") {
      status = "capture_failed";
      reasons = [capture.error ?? "capture failed", ...capture.browser_errors];
    } else if (!primary) {
      status = "not_judged";
    } else {
      status = primary.status;
      reasons = [primary.error, ...primary.warnings].filter((r): r is string => Boolean(r));
    }

    return {
      sample_id: sampleId,
      blind_id: blindId(sampleId),
      prompt: valid?.prompt ?? meta!.prompt,
      prompt_family_id: valid?.prompt_family_id ?? meta!.prompt_family_id,
      split: valid?.split ?? meta!.split,
      generator: valid?.generator ?? meta!.generator,
      provenance_kind: valid?.provenance.kind ?? meta!.provenance_kind,
      player_rating: valid?.provenance.player_rating ?? null,
      visual_attributes_applicable: valid?.visual_attributes_applicable ?? null,
      status,
      input_issue: validation.status === "valid" ? null : validation.issue,
      reasons,
      capture,
      judgments,
      scores: Object.fromEntries(DIMENSIONS.map((d) => [d, primary?.questions[d] ?? null])) as SampleResult["scores"],
      human: { primary: primaryLabel(humanAll, primaryReviewer), all: humanAll },
    };
  });
}
