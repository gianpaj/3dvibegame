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

// Which judge's results a report uses. A run can hold both (a mock pipeline
// check followed by a partial live run); mixing them would blend synthetic
// scores into real metrics, so a report uses live results whenever any exist.
export type JudgeMode = "live" | "mock";

export function collectResults(
  runId: string,
  labels: LoadedLabels | null,
  primaryReviewer?: string,
): { mode: JudgeMode; results: SampleResult[] } {
  const samples = readSamples(runId).map((validation) => {
    const sampleId = validation.status === "valid" ? validation.sample.sample_id : validation.meta.sample_id;
    const capture = validation.status === "valid" ? readCapture(runId, sampleId) : null;
    const judgments = validation.status === "valid" ? readJudgments(runId, sampleId) : [];
    return { validation, sampleId, capture, judgments };
  });
  const mode: JudgeMode = samples.some((s) => s.judgments.some((j) => !j.judge.mock)) ? "live" : "mock";

  const results = samples.map(({ validation, sampleId, capture, judgments: allJudgments }): SampleResult => {
    const valid = validation.status === "valid" ? validation.sample : null;
    const meta = validation.status === "valid" ? null : validation.meta;
    // Only judgments of the current images, from the chosen judge mode.
    const currentViews = capture?.status === "captured" ? capture.views.map((v) => v.sha256).join() : null;
    const current = allJudgments.filter(
      (j) => currentViews !== null && j.view_sha256?.join() === currentViews && j.judge.mock === (mode === "mock"),
    );
    const primary = current.find((j) => j.trial === 0) ?? null;
    // Repeat trials count only when made from exactly the same inputs as
    // trial 0 (same images, rubric, model and mode).
    const judgments = primary ? current.filter((j) => j.cache_key === primary.cache_key) : [];
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
      if (allJudgments.some((j) => j.trial === 0)) {
        reasons = [
          `existing judgment is from ${allJudgments.some((j) => j.judge.mock !== (mode === "mock")) ? "the other judge mode or " : ""}` +
            "an earlier capture; re-run judge",
        ];
      }
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
  return { mode, results };
}
