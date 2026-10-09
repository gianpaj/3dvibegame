import { DIMENSIONS, type QuestionOutcome } from "../contracts.ts";
import type { SampleResult } from "./results.ts";

// One row per sample (primary trial). Scores keep their state: an empty score
// with state "not_applicable" or "refused" is never written as 0.
export function resultsCsv(results: SampleResult[]): string {
  const header = [
    "sample_id",
    "split",
    "prompt_family_id",
    "status",
    "input_issue",
    "generator_model_id",
    "generator_prompt_version",
    "player_rating",
    "prompt",
    ...DIMENSIONS.flatMap((d) => [`${d}_state`, `${d}_score`, `${d}_confidence`, `${d}_human`]),
    "human_reviewer",
    "trials",
    "capture_latency_ms",
    "judge_latency_ms",
    "input_tokens",
    "estimated_cost_usd",
    "judge_mock",
    "reasons",
  ];
  const rows = results.map((r) => {
    const primary = r.judgments.find((j) => j.trial === 0);
    const label = r.human.primary;
    return [
      r.sample_id,
      r.split,
      r.prompt_family_id,
      r.status,
      r.input_issue,
      r.generator.model_id,
      r.generator.prompt_version,
      r.player_rating,
      r.prompt,
      ...DIMENSIONS.flatMap((d) => {
        const q: QuestionOutcome | null = r.scores[d];
        return [
          q?.state ?? null,
          q?.state === "answered" ? q.score.toFixed(4) : null,
          q?.state === "answered" ? q.confidence.toFixed(4) : null,
          label ? label[d] : null,
        ];
      }),
      label?.reviewer_id ?? null,
      r.judgments.length,
      r.capture?.capture_latency_ms ?? null,
      primary?.judge_latency_ms ?? null,
      primary?.usage?.input_tokens ?? null,
      primary?.estimated_cost_usd?.toFixed(6) ?? null,
      primary ? primary.judge.mock : null,
      r.reasons.join(" | "),
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Spreadsheet formula injection: prompts are untrusted player text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
