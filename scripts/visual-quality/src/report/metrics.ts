import { DIMENSIONS, type Dimension, type InputIssue, type JudgmentRecord } from "../contracts.ts";
import type { ResolvedLabel } from "../labels.ts";
import { SAMPLE_STATUSES, type SampleResult, type SampleStatus } from "./results.ts";

// Diagnostic bins, fixed before any holdout results are inspected. Change them
// only on development data, and bump the version when you do.
export const DIAGNOSTIC_BINS = {
  version: "bins-v1",
  // Human level that counts as a severe failure / a clear success.
  severe_human_level: 0,
  success_human_level: 3,
  // AI scores that count as "high" for a severe failure, "low" for a success.
  high_ai_score: 2,
  low_ai_score: 1,
  // |AI − human| above this is a large over- or under-score.
  large_error: 1,
} as const;

// Shares carry their denominators so reports never show a bare percentage.
export interface Share {
  count: number;
  of: number;
  rate: number | null;
}

function share(count: number, of: number): Share {
  return { count, of, rate: of ? count / of : null };
}

// ---------------------------------------------------------------------------
// Coverage

export interface Coverage {
  total: number;
  by_status: Record<SampleStatus, number>;
  input_issues: Record<InputIssue, number>;
  evaluated: Share;
  capture_failures: Share;
  api_errors: Share;
  refusals: Share;
}

export function coverage(results: SampleResult[]): Coverage {
  const by_status = Object.fromEntries(SAMPLE_STATUSES.map((s) => [s, 0])) as Record<SampleStatus, number>;
  const input_issues: Record<InputIssue, number> = { malformed: 0, unsupported: 0, needs_curation: 0, artifact_failure: 0 };
  for (const r of results) {
    by_status[r.status] += 1;
    if (r.input_issue) input_issues[r.input_issue] += 1;
  }
  const captureAttempts = results.filter((r) => r.capture !== null).length;
  const judged = by_status.completed + by_status.incomplete + by_status.refused + by_status.api_error;
  return {
    total: results.length,
    by_status,
    input_issues,
    evaluated: share(by_status.completed, results.length),
    capture_failures: share(by_status.capture_failed, captureAttempts),
    api_errors: share(by_status.api_error, judged),
    refusals: share(by_status.refused, judged),
  };
}

// ---------------------------------------------------------------------------
// Agreement with human labels

export type HumanValue = number | "not_applicable";

export interface DimensionAgreement {
  dimension: Dimension;
  // Paired samples: AI answered and the human gave a level.
  n: number;
  mean_absolute_error: number | null;
  // Mean of AI − human: positive means the judge scores higher than people.
  bias: number | null;
  // The AI score rounded to the nearest level, compared with the human level.
  exact: Share;
  within_one: Share;
  categories: { exact: number; adjacent: number; over: number; under: number };
  // Severe human failures with high AI scores, and clear successes with low ones.
  false_pass: string[];
  false_fail: string[];
  // Why labelled samples are excluded from the pairs.
  excluded: { ai_not_answered: string[]; applicability_mismatch: string[] };
}

export function humanValue(label: ResolvedLabel, dimension: Dimension): HumanValue {
  return label[dimension];
}

export function agreement(results: SampleResult[], dimension: Dimension): DimensionAgreement {
  const errors: number[] = [];
  const out: DimensionAgreement = {
    dimension,
    n: 0,
    mean_absolute_error: null,
    bias: null,
    exact: share(0, 0),
    within_one: share(0, 0),
    categories: { exact: 0, adjacent: 0, over: 0, under: 0 },
    false_pass: [],
    false_fail: [],
    excluded: { ai_not_answered: [], applicability_mismatch: [] },
  };
  let exact = 0;
  let withinOne = 0;

  for (const r of results) {
    const label = r.human.primary;
    if (!label) continue;
    const human = humanValue(label, dimension);
    const ai = r.scores[dimension];
    const aiApplicable = ai !== null && ai.state !== "not_applicable";
    // Attribute fidelity: the sample's curated flag and the reviewer disagree
    // on whether explicit visual attributes were requested.
    if (r.status === "completed" || r.status === "incomplete" || r.status === "refused") {
      if ((human === "not_applicable") === aiApplicable) {
        out.excluded.applicability_mismatch.push(r.sample_id);
        continue;
      }
    }
    if (human === "not_applicable") continue;
    if (ai?.state !== "answered") {
      out.excluded.ai_not_answered.push(r.sample_id);
      continue;
    }
    const error = ai.score - human;
    errors.push(error);
    const level = Math.round(ai.score);
    if (level === human) exact += 1;
    if (Math.abs(level - human) <= 1) withinOne += 1;
    if (level === human) out.categories.exact += 1;
    else if (Math.abs(error) <= DIAGNOSTIC_BINS.large_error) out.categories.adjacent += 1;
    else if (error > 0) out.categories.over += 1;
    else out.categories.under += 1;
    if (human <= DIAGNOSTIC_BINS.severe_human_level && ai.score >= DIAGNOSTIC_BINS.high_ai_score) out.false_pass.push(r.sample_id);
    if (human >= DIAGNOSTIC_BINS.success_human_level && ai.score <= DIAGNOSTIC_BINS.low_ai_score) out.false_fail.push(r.sample_id);
  }

  out.n = errors.length;
  if (out.n) {
    out.mean_absolute_error = mean(errors.map(Math.abs));
    out.bias = mean(errors);
  }
  out.exact = share(exact, out.n);
  out.within_one = share(withinOne, out.n);
  return out;
}

export interface CalibrationSplit {
  labelled: number;
  // Rubric hashes behind this split's primary judgments. More than one means
  // the rubric changed mid-split (e.g. edited after it was frozen).
  rubric_sha256: string[];
  dimensions: Record<Dimension, DimensionAgreement>;
}

// Calibration is reported per split; unassigned samples are excluded.
export function calibration(results: SampleResult[]): Record<"development" | "holdout", CalibrationSplit> {
  const forSplit = (split: "development" | "holdout"): CalibrationSplit => {
    const subset = results.filter((r) => r.split === split);
    return {
      labelled: subset.filter((r) => r.human.primary).length,
      rubric_sha256: [
        ...new Set(subset.flatMap((r) => r.judgments.filter((j) => j.trial === 0).map((j) => j.rubric.sha256))),
      ].sort(),
      dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, agreement(subset, d)])) as Record<Dimension, DimensionAgreement>,
    };
  };
  return { development: forSplit("development"), holdout: forSplit("holdout") };
}

// ---------------------------------------------------------------------------
// Inter-reviewer agreement (samples with two or more reviewers)

export interface ReviewerAgreement {
  pairs: number;
  exact: Share;
  within_one: Share;
  applicability_mismatches: number;
}

export function reviewerAgreement(results: SampleResult[]): Record<Dimension, ReviewerAgreement> {
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      let pairs = 0;
      let exact = 0;
      let withinOne = 0;
      let mismatches = 0;
      for (const r of results) {
        const labels = r.human.all;
        for (let i = 0; i < labels.length; i += 1) {
          for (let j = i + 1; j < labels.length; j += 1) {
            const a = humanValue(labels[i]!, dimension);
            const b = humanValue(labels[j]!, dimension);
            if (a === "not_applicable" || b === "not_applicable") {
              if (a !== b) mismatches += 1;
              continue;
            }
            pairs += 1;
            if (a === b) exact += 1;
            if (Math.abs(a - b) <= 1) withinOne += 1;
          }
        }
      }
      return [
        dimension,
        { pairs, exact: share(exact, pairs), within_one: share(withinOne, pairs), applicability_mismatches: mismatches },
      ];
    }),
  ) as Record<Dimension, ReviewerAgreement>;
}

// ---------------------------------------------------------------------------
// Repeatability (samples judged in two or more completed trials)

export interface Repeatability {
  samples: number;
  mean_range: number | null;
  max_range: number | null;
  mean_sd: number | null;
  stable_level: Share;
}

export function repeatability(results: SampleResult[]): Record<Dimension, Repeatability> {
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const series = results
        .map((r) =>
          r.judgments
            .filter((j) => j.status === "completed")
            .flatMap((j) => {
              const q = j.questions[dimension];
              return q.state === "answered" ? [q.score] : [];
            }),
        )
        .filter((scores) => scores.length >= 2);
      const ranges = series.map((s) => Math.max(...s) - Math.min(...s));
      const stable = series.filter((s) => new Set(s.map(Math.round)).size === 1).length;
      return [
        dimension,
        {
          samples: series.length,
          mean_range: series.length ? mean(ranges) : null,
          max_range: series.length ? Math.max(...ranges) : null,
          mean_sd: series.length ? mean(series.map(sd)) : null,
          stable_level: share(stable, series.length),
        },
      ];
    }),
  ) as Record<Dimension, Repeatability>;
}

// ---------------------------------------------------------------------------
// Latency and usage (fresh work only: reused captures and judgments cost
// nothing in this run)

export interface LatencySummary {
  n: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

export function latency(values: number[]): LatencySummary {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null);
  return { n: sorted.length, p50_ms: pick(0.5), p95_ms: pick(0.95), max_ms: sorted.at(-1) ?? null };
}

export interface UsageSummary {
  fresh_judgments: number;
  reused_judgments: number;
  requests: number;
  input_tokens: number;
  estimated_cost_usd: number;
  judgments_without_usage: number;
  mock: boolean;
}

export function usage(results: SampleResult[]): UsageSummary {
  const all = results.flatMap((r) => r.judgments);
  const fresh = all.filter((j) => j.reused_from === null);
  return {
    fresh_judgments: fresh.length,
    reused_judgments: all.length - fresh.length,
    requests: sum(fresh.map((j) => j.attempts.length)),
    input_tokens: sum(fresh.map((j) => j.usage?.input_tokens ?? 0)),
    estimated_cost_usd: sum(fresh.map((j) => j.estimated_cost_usd ?? 0)),
    judgments_without_usage: fresh.filter((j) => j.usage === null).length,
    mock: all.some((j) => j.judge.mock),
  };
}

export function timings(results: SampleResult[]) {
  const freshJudgments: JudgmentRecord[] = results.flatMap((r) => r.judgments).filter((j) => j.reused_from === null);
  return {
    capture: latency(
      results.flatMap((r) => (r.capture && r.capture.reused_from === null ? [r.capture.capture_latency_ms] : [])),
    ),
    judge: latency(freshJudgments.map((j) => j.judge_latency_ms)),
  };
}

// ---------------------------------------------------------------------------
// Generator comparison

export interface GeneratorGroup {
  key: string;
  model_id: string | null;
  prompt_version: string | null;
  total: number;
  by_status: Record<SampleStatus, number>;
  evaluated: Share;
  families: string[];
  // Mean AI score over answered samples; null when coverage isn't comparable.
  means: Record<Dimension, { mean: number; n: number } | null> | null;
}

export interface GeneratorComparison {
  comparable: boolean;
  reason: string | null;
  groups: GeneratorGroup[];
}

const MIN_COMPARABLE_COVERAGE = 0.9;

// Means are shown only when every group covers the same prompt families and
// was evaluated on nearly all samples; otherwise a comparison would silently
// exclude failures. There is deliberately no blended overall score.
export function generatorComparison(results: SampleResult[]): GeneratorComparison {
  const groups = new Map<string, SampleResult[]>();
  for (const r of results) {
    const key = `${r.generator.model_id ?? "unknown"} @ ${r.generator.prompt_version ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const built = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, members]): GeneratorGroup => {
      const cov = coverage(members);
      return {
        key,
        model_id: members[0]!.generator.model_id,
        prompt_version: members[0]!.generator.prompt_version,
        total: members.length,
        by_status: cov.by_status,
        evaluated: cov.evaluated,
        families: [...new Set(members.map((m) => m.prompt_family_id ?? "unknown"))].sort(),
        means: Object.fromEntries(
          DIMENSIONS.map((d) => {
            const scores = members.flatMap((m) => {
              const q = m.scores[d];
              return q?.state === "answered" ? [q.score] : [];
            });
            return [d, scores.length ? { mean: mean(scores), n: scores.length } : null];
          }),
        ) as GeneratorGroup["means"],
      };
    });

  let reason: string | null = null;
  const familyKey = (g: GeneratorGroup) => g.families.join("\u0000");
  if (built.some((g) => (g.evaluated.rate ?? 0) < MIN_COMPARABLE_COVERAGE)) {
    reason = `a group has evaluation coverage below ${MIN_COMPARABLE_COVERAGE * 100}%`;
  } else if (new Set(built.map(familyKey)).size > 1) {
    reason = "groups cover different prompt families";
  }
  if (reason) for (const g of built) g.means = null;
  return { comparable: reason === null, reason, groups: built };
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function sd(values: number[]) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}
