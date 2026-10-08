import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  RUN_FORMAT,
  type CaptureRecord,
  type JudgmentRecord,
  type RunManifest,
  type RunStep,
  type SampleValidation,
} from "./contracts.ts";
import type { LoadedDataset } from "./dataset.ts";
import { readJson, writeJson } from "./files.ts";
import { repoRelative, repoRoot, runsRoot } from "./paths.ts";

// A run directory holds everything needed to audit or resume an evaluation:
//
//   runs/<run-id>/run.json                       manifest + step log
//   runs/<run-id>/samples/<id>/sample.json        validation outcome (input)
//   runs/<run-id>/samples/<id>/capture.json       capture record
//   runs/<run-id>/samples/<id>/views/<view>.png   captured views
//   runs/<run-id>/samples/<id>/judgments/<n>.json judge trials
//   runs/<run-id>/report/                         generated reports

export function runDir(runId: string) {
  return path.join(runsRoot, runId);
}

export function sampleDir(runId: string, sampleId: string) {
  return path.join(runDir(runId), "samples", sampleId);
}

export function newRunId(datasetId: string, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${datasetId.replace(/[^a-z0-9_-]/gi, "_")}`;
}

export function assertRunId(runId: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error(`invalid run id "${runId}"`);
}

// Creates a run for a dataset, or reopens it to resume. A run is bound to the
// dataset content it was created with; a changed dataset needs a new run.
export function openRun(runId: string, dataset: LoadedDataset): RunManifest {
  assertRunId(runId);
  const manifestPath = path.join(runDir(runId), "run.json");
  if (existsSync(manifestPath)) {
    const manifest = readRunManifest(runId);
    if (manifest.dataset.sha256 !== dataset.sha256) {
      throw new Error(
        `run ${runId} was created from different dataset content; start a new run (omit --run)`,
      );
    }
    return manifest;
  }
  const manifest: RunManifest = {
    format: RUN_FORMAT,
    run_id: runId,
    created_at: new Date().toISOString(),
    dataset: {
      path: repoRelative(dataset.path),
      dataset_id: dataset.dataset_id,
      sha256: dataset.sha256,
      sample_count: dataset.validations.length,
    },
    git: gitInfo(),
    environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
    steps: [],
  };
  writeJson(manifestPath, manifest);
  for (const validation of dataset.validations) {
    writeJson(path.join(sampleDir(runId, sampleIdOf(validation)), "sample.json"), validation);
  }
  return manifest;
}

export function readRunManifest(runId: string): RunManifest {
  assertRunId(runId);
  const manifestPath = path.join(runDir(runId), "run.json");
  if (!existsSync(manifestPath)) throw new Error(`run ${runId} not found under ${repoRelative(runsRoot)}`);
  const manifest = readJson<RunManifest>(manifestPath);
  if (manifest.format !== RUN_FORMAT) throw new Error(`run ${runId}: unsupported format ${manifest.format}`);
  return manifest;
}

export function recordStep(runId: string, step: RunStep) {
  const manifest = readRunManifest(runId);
  manifest.steps.push(step);
  writeJson(path.join(runDir(runId), "run.json"), manifest);
}

export function sampleIdOf(validation: SampleValidation) {
  return validation.status === "valid" ? validation.sample.sample_id : validation.meta.sample_id;
}

export function readSamples(runId: string): SampleValidation[] {
  const dir = path.join(runDir(runId), "samples");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((id) => readJson<SampleValidation>(path.join(dir, id, "sample.json")));
}

export function readCapture(runId: string, sampleId: string): CaptureRecord | null {
  const file = path.join(sampleDir(runId, sampleId), "capture.json");
  return existsSync(file) ? readJson<CaptureRecord>(file) : null;
}

export function readJudgments(runId: string, sampleId: string): JudgmentRecord[] {
  const dir = path.join(sampleDir(runId, sampleId), "judgments");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^\d+\.json$/.test(file))
    .map((file) => readJson<JudgmentRecord>(path.join(dir, file)))
    .sort((a, b) => a.trial - b.trial);
}

export function judgmentPath(runId: string, sampleId: string, trial: number) {
  return path.join(sampleDir(runId, sampleId), "judgments", `${trial}.json`);
}

function gitInfo(): RunManifest["git"] {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}
