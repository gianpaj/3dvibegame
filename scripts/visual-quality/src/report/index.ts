import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeJson } from "../files.ts";
import { loadRubric, type LoadedRubric } from "../judge/rubric.ts";
import { loadLabelFiles, type LoadedLabels } from "../labels.ts";
import { evalsRoot } from "../paths.ts";
import { readRunManifest, readSamples, runDir, sampleDir, sampleIdOf } from "../run.ts";
import { resultsCsv } from "./csv.ts";
import { blindHtml, reportHtml, SCALE_DISCLAIMER, type BlindItem, type ReportModel } from "./html.ts";
import {
  calibration,
  coverage,
  DIAGNOSTIC_BINS,
  generatorComparison,
  repeatability,
  reviewerAgreement,
  timings,
  usage,
} from "./metrics.ts";
import { collectResults } from "./results.ts";

export interface ReportOptions {
  labelFiles: string[];
  primaryReviewer?: string;
}

// Regenerates every report artifact for a run from saved records. Offline: it
// reads only the run directory, label files and the rubric.
export function generateReport(runId: string, options: ReportOptions) {
  const manifest = readRunManifest(runId);
  const sampleIds = readSamples(runId).map(sampleIdOf);
  const labels: LoadedLabels | null = options.labelFiles.length ? loadLabelFiles(options.labelFiles, sampleIds) : null;
  const { mode, results } = collectResults(runId, labels, options.primaryReviewer);
  const outDir = path.join(runDir(runId), "report");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const model: ReportModel = {
    manifest,
    judgeMode: mode,
    generatedAt: new Date().toISOString(),
    results,
    coverage: coverage(results),
    calibration: labels ? calibration(results) : null,
    reviewers: labels ? reviewerAgreement(results) : null,
    repeatability: repeatability(results),
    comparison: generatorComparison(results),
    timings: timings(results),
    usage: usage(results),
    rubricVersions: [...new Set(results.flatMap((r) => r.judgments.map((j) => `${j.rubric.version} (${j.rubric.sha256.slice(0, 8)})`)))].sort(),
    unmatchedLabels: labels?.unmatched.length ?? 0,
    imagePath: (sampleId, file) => `../samples/${sampleId}/${file}`,
  };

  writeJson(path.join(outDir, "results.json"), {
    format: "vq-results/v1",
    run_id: runId,
    generated_at: model.generatedAt,
    disclaimer: SCALE_DISCLAIMER,
    judge_mode: mode,
    mock: model.usage.mock,
    diagnostic_bins: DIAGNOSTIC_BINS,
    rubric_versions: model.rubricVersions,
    label_files: options.labelFiles.map((f) => path.basename(f)),
    primary_reviewer: options.primaryReviewer ?? null,
    coverage: model.coverage,
    calibration: model.calibration,
    reviewer_agreement: model.reviewers,
    repeatability: model.repeatability,
    generator_comparison: model.comparison,
    timings: model.timings,
    usage: model.usage,
    unmatched_labels: labels?.unmatched ?? [],
    samples: results.map(({ capture, judgments, ...rest }) => ({
      ...rest,
      capture: capture && {
        status: capture.status,
        error: capture.error,
        views: capture.views.map(({ view_id, file, sha256, stats }) => ({ view_id, file, sha256, stats })),
        capture_latency_ms: capture.capture_latency_ms,
        reused_from: capture.reused_from,
      },
      judgments: judgments.map((j) => ({
        trial: j.trial,
        status: j.status,
        questions: j.questions,
        usage: j.usage,
        estimated_cost_usd: j.estimated_cost_usd,
        judge_latency_ms: j.judge_latency_ms,
        evaluated_at: j.evaluated_at,
        reused_from: j.reused_from,
        mock: j.judge.mock,
      })),
    })),
  });
  writeFileSync(path.join(outDir, "results.csv"), resultsCsv(results));
  writeFileSync(path.join(outDir, "index.html"), reportHtml(model));

  // Blind view: images are copied under blind IDs so file paths can't reveal
  // sample IDs (which may encode the generator).
  const blindDir = path.join(outDir, "blind");
  mkdirSync(blindDir, { recursive: true });
  const blindItems: BlindItem[] = results
    .filter((r) => r.capture?.status === "captured" && r.prompt !== null)
    .map((r) => ({
      blind_id: r.blind_id,
      prompt: r.prompt!,
      views: r.capture!.views.map((view) => {
        const name = `${r.blind_id}-${view.view_id}.png`;
        copyFileSync(path.join(sampleDir(runId, r.sample_id), view.file), path.join(blindDir, name));
        return { label: view.label, src: `blind/${name}` };
      }),
    }))
    .sort((a, b) => a.blind_id.localeCompare(b.blind_id));
  writeFileSync(path.join(outDir, "blind.html"), blindHtml(blindItems, rubricForRun(runId).rubric));

  return {
    outDir,
    mode,
    results,
    coverage: model.coverage,
    labelled: results.filter((r) => r.human.primary).length,
    unmatchedLabels: labels?.unmatched ?? [],
  };
}

// The rubric most recently used to judge the run, else the default rubric.
function rubricForRun(runId: string): LoadedRubric {
  const dir = path.join(runDir(runId), "rubrics");
  if (existsSync(dir)) {
    const latest = readdirSync(dir)
      .map((name) => path.join(dir, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (latest) return loadRubric(latest);
  }
  return loadRubric(path.join(evalsRoot, "rubric", "v1.json"));
}
