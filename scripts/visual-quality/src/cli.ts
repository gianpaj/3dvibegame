import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { captureRun } from "./capture/index.ts";
import { loadDataset } from "./dataset.ts";
import { writeJson } from "./files.ts";
import { importFeedbackRows } from "./importFeedback.ts";
import { HttpDecisionsClient, MockDecisionsClient, type DecisionsClient } from "./judge/client.ts";
import { DEFAULT_JUDGE_CONFIG, DEFAULT_USD_PER_INPUT_TOKEN, judgeRun } from "./judge/index.ts";
import type { JudgeConfig } from "./judge/request.ts";
import { loadRubric } from "./judge/rubric.ts";
import { evalsRoot, repoRelative, repoRoot, resolveUserPath, tmpRoot } from "./paths.ts";
import { generateReport } from "./report/index.ts";
import {
  newRunId,
  openRun,
  readCapture,
  readRunManifest,
  readSamples,
  recordStep,
  runDir,
  sampleIdOf,
} from "./run.ts";

const DEFAULT_DATASET = path.join(evalsRoot, "fixtures", "manifest.json");
const DEFAULT_RUBRIC = path.join(evalsRoot, "rubric", "v1.json");
const DEFAULT_FIXTURE_LABELS = path.join(evalsRoot, "fixtures", "labels.json");

const BUDGET_DISCLOSURE =
  "Limits are enforced before each attempt (retries included), but they are not an exact dollar cap: " +
  "requests in flight can finish after a limit is reached, and image tokens are estimated until usage is reported.";

const USAGE = `Offline visual-quality evaluation

Usage: pnpm vq <command> [options]

Commands:
  validate        Validate a dataset manifest offline
                    --dataset <path>   (default: evals/visual-quality/fixtures/manifest.json)
  import-feedback Convert exported object_feedback rows (JSON array) into a
                  dataset for manual curation under .tmp/visual-quality/imports/
                    --input <path> --name <dataset-name>
  capture         Validate a dataset and render three views per valid sample
                    --dataset <path>   (default: the run's dataset, else fixtures)
                    --run <run-id>     resume or extend a run (default: new run)
                    --samples <a,b>    only these sample IDs
                    --no-reuse         re-render even when a cached capture matches
  judge           Score captured views with the OpenAI Decisions API
                    --run <run-id>         (required)
                    --mock                 offline deterministic judge (no API calls)
                    --execute              make paid API calls (needs OPENAI_API_KEY)
                                           without --mock/--execute: dry run, prints the plan
                    --rubric <path>        (default: evals/visual-quality/rubric/v1.json)
                    --model <id>           (default: ${DEFAULT_JUDGE_CONFIG.model})
                    --image-detail <auto|low|high|original>  (default: auto)
                    --max-requests <n>     paid attempts incl. retries (default: 50)
                    --max-cost-usd <x>     estimated spend limit (default: 0.50)
                    --concurrency <n>      (default: 4)
                    --deadline-ms <n>      per-request deadline (default: 60000)
                    --max-retries <n>      transient failures only (default: 2)
                    --tokens-per-image <n> pre-usage estimate (default: 1600)
                    --trials <n>           repeated judging per sample (default: 1)
                    --samples <a,b>        only these sample IDs
                    --no-reuse             ignore cached judgments
  report          Regenerate the HTML gallery, blind labelling view and JSON/CSV (offline)
                    --run <run-id>         (required)
                    --labels <a.json,b.json>  human label files
                    --primary-reviewer <id>   reviewer compared with the judge (default: first label)
  offline         Full offline check on a new run: capture, mock judging, report
                    --dataset <path>   (default: fixtures)
                    --labels <files>   (default: fixture labels when using fixtures)
`;

type Handler = (argv: string[]) => Promise<number>;

async function validateCommand(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { dataset: { type: "string" } } });
  const dataset = loadDataset(values.dataset ? resolveUserPath(values.dataset) : DEFAULT_DATASET);
  let valid = 0;
  for (const v of dataset.validations) {
    if (v.status === "valid") {
      valid += 1;
      console.log(`ok       ${v.sample.sample_id}${v.warnings.length ? `  (${v.warnings.join("; ")})` : ""}`);
    } else {
      console.log(`${v.issue.padEnd(8)} ${v.meta.sample_id}: ${v.reasons.join("; ")}`);
    }
  }
  console.log(`\n${valid}/${dataset.validations.length} samples valid (dataset ${dataset.dataset_id})`);
  return 0;
}

async function importFeedbackCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { input: { type: "string" }, name: { type: "string" } },
  });
  if (!values.input || !values.name) throw new UsageError("--input and --name are required");
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(values.name)) throw new UsageError("--name must be a simple identifier");
  const rows: unknown = JSON.parse(readFileSync(resolveUserPath(values.input), "utf8"));
  if (!Array.isArray(rows)) throw new UsageError("--input must contain a JSON array of rows");

  const result = importFeedbackRows(rows, values.name);
  // Imports may contain private prompts; keep them under the ignored .tmp tree.
  const outDir = path.join(tmpRoot, "imports", values.name);
  mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "manifest.json"), result.manifest);
  writeJson(path.join(outDir, "import-report.json"), {
    imported: result.manifest.samples.length,
    excluded: result.excluded,
    privacy_flags: result.privacy_flags,
  });
  console.log(`imported ${result.manifest.samples.length} create records, excluded ${result.excluded.length}`);
  for (const flag of result.privacy_flags) {
    console.log(`  review ${flag.sample_id}: prompt may contain ${flag.matches.join(", ")}`);
  }
  console.log(`wrote ${repoRelative(outDir)}/manifest.json — curate it before capture or judging`);
  return 0;
}

async function captureCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dataset: { type: "string" },
      run: { type: "string" },
      samples: { type: "string" },
      "no-reuse": { type: "boolean", default: false },
    },
  });
  const started = new Date().toISOString();
  const { runId, sampleIds } = openRunFor(values.run, values.dataset, values.samples);
  const summary = await captureRun(runId, { reuse: !values["no-reuse"], sampleIds });
  recordStep(runId, {
    command: "capture",
    started_at: started,
    finished_at: new Date().toISOString(),
    options: { reuse: !values["no-reuse"], samples: sampleIds ?? "all" },
    summary: { ...summary },
  });
  console.log(
    `run ${runId}: ${summary.captured} captured, ${summary.reused} reused from cache, ` +
      `${summary.resumed} already in run, ${summary.failed} failed, ${summary.not_valid} not valid`,
  );
  for (const failure of summary.failures) console.log(`  capture_failed ${failure.sample_id}: ${failure.error}`);
  console.log(`  ${repoRelative(runDir(runId))}`);
  return 0;
}

async function judgeCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string" },
      mock: { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
      rubric: { type: "string" },
      model: { type: "string", default: DEFAULT_JUDGE_CONFIG.model },
      "image-detail": { type: "string", default: DEFAULT_JUDGE_CONFIG.image_detail },
      "max-requests": { type: "string", default: "50" },
      "max-cost-usd": { type: "string", default: "0.50" },
      concurrency: { type: "string", default: "4" },
      "deadline-ms": { type: "string", default: "60000" },
      "max-retries": { type: "string", default: "2" },
      "tokens-per-image": { type: "string", default: "1600" },
      trials: { type: "string", default: "1" },
      samples: { type: "string" },
      "no-reuse": { type: "boolean", default: false },
    },
  });
  if (!values.run) throw new UsageError("--run is required");
  readRunManifest(values.run);
  if (values.mock && values.execute) throw new UsageError("use either --mock or --execute, not both");
  const detail = values["image-detail"] as JudgeConfig["image_detail"];
  if (!["auto", "low", "high", "original"].includes(detail)) throw new UsageError("invalid --image-detail");
  const rubricPath = values.rubric ? resolveUserPath(values.rubric) : DEFAULT_RUBRIC;
  const rubric = loadRubric(rubricPath);
  const options = {
    config: { model: values.model, image_detail: detail },
    limits: {
      maxRequests: positiveInt(values["max-requests"], "--max-requests"),
      maxCostUsd: positiveNumber(values["max-cost-usd"], "--max-cost-usd"),
      usdPerInputToken: DEFAULT_USD_PER_INPUT_TOKEN,
    },
    concurrency: positiveInt(values.concurrency, "--concurrency"),
    deadlineMs: positiveInt(values["deadline-ms"], "--deadline-ms"),
    maxRetries: nonNegativeInt(values["max-retries"], "--max-retries"),
    estimatedTokensPerImage: positiveInt(values["tokens-per-image"], "--tokens-per-image"),
    trials: positiveInt(values.trials, "--trials"),
    reuse: !values["no-reuse"],
    sampleIds: sampleSelection(readSamples(values.run).map(sampleIdOf), values.samples),
  };

  if (!values.mock && !values.execute) {
    const eligible = readSamples(values.run).filter(
      (v) =>
        v.status === "valid" &&
        (!options.sampleIds || options.sampleIds.includes(v.sample.sample_id)) &&
        readCapture(values.run!, v.sample.sample_id)?.status === "captured",
    ).length;
    const tasks = eligible * options.trials;
    const perRequest = 3 * options.estimatedTokensPerImage + 1_500;
    const worstCase = Math.min(tasks * (1 + options.maxRetries), options.limits.maxRequests) * perRequest * DEFAULT_USD_PER_INPUT_TOKEN;
    console.log(`dry run: ${eligible} captured samples x ${options.trials} trial(s) = ${tasks} judgments`);
    console.log(`  model ${options.config.model}, rubric ${rubric.rubric.version} (${rubric.rubric.status})`);
    console.log(`  limits: ${options.limits.maxRequests} requests, $${options.limits.maxCostUsd}`);
    console.log(`  worst-case estimate: ~$${worstCase.toFixed(4)} (cached results are reused at no cost)`);
    console.log(`  ${BUDGET_DISCLOSURE}`);
    console.log("re-run with --mock for an offline pipeline check, or --execute to call the API");
    return 0;
  }

  let client: DecisionsClient;
  let secrets: string[] = [];
  if (values.execute) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new UsageError("--execute needs OPENAI_API_KEY in the environment");
    client = new HttpDecisionsClient(apiKey);
    secrets = [apiKey];
    console.log(`paid judging: ${BUDGET_DISCLOSURE}`);
  } else {
    client = new MockDecisionsClient();
    console.log("mock judging: scores are synthetic and say nothing about visual quality");
  }

  const started = new Date().toISOString();
  const summary = await judgeRun(values.run, {
    ...options,
    client,
    rubric,
    secrets,
    log: (line) => console.log(`  ${line}`),
  });
  recordStep(values.run, {
    command: "judge",
    started_at: started,
    finished_at: new Date().toISOString(),
    options: {
      ...options,
      mode: values.execute ? "live" : "mock",
      rubric: { path: repoRelative(rubricPath), version: rubric.rubric.version, sha256: rubric.sha256 },
    },
    summary: { ...summary },
  });
  console.log(
    `run ${values.run}: ${summary.completed} completed, ${summary.reused} reused, ${summary.resumed} already in run, ` +
      `${summary.refused} refused, ${summary.incomplete} incomplete, ${summary.api_error} API errors, ` +
      `${summary.not_judged} not judged, ${summary.not_captured} not captured`,
  );
  console.log(
    `  ${summary.requests} requests (${summary.retries} retries), ${summary.input_tokens} reported input tokens, ` +
      `~$${summary.estimated_cost_usd.toFixed(5)}${summary.mock ? " (mock)" : ""}`,
  );
  if (summary.budget_exhausted) console.log(`  stopped scheduling: ${summary.budget_exhausted}`);
  return 0;
}

function positiveInt(value: string, flag: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a positive integer`);
  return n;
}

function nonNegativeInt(value: string, flag: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} must be a non-negative integer`);
  return n;
}

function positiveNumber(value: string, flag: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} must be a positive number`);
  return n;
}

async function reportCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { run: { type: "string" }, labels: { type: "string" }, "primary-reviewer": { type: "string" } },
  });
  if (!values.run) throw new UsageError("--run is required");
  printReport(values.run, splitList(values.labels).map(resolveUserPath), values["primary-reviewer"]);
  return 0;
}

async function offlineCommand(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { dataset: { type: "string" }, labels: { type: "string" } } });
  const labels = values.labels
    ? splitList(values.labels).map(resolveUserPath)
    : values.dataset
      ? []
      : [DEFAULT_FIXTURE_LABELS];
  const { runId } = openRunFor(undefined, values.dataset);
  for (const [name, handler, args] of [
    ["capture", captureCommand, ["--run", runId]],
    ["judge", judgeCommand, ["--run", runId, "--mock"]],
  ] as const) {
    console.log(`\n== ${name}`);
    const code = await handler([...args]);
    if (code !== 0) return code;
  }
  console.log("\n== report");
  printReport(runId, labels, undefined);
  return 0;
}

const commands: Record<string, Handler> = {
  validate: validateCommand,
  "import-feedback": importFeedbackCommand,
  capture: captureCommand,
  judge: judgeCommand,
  report: reportCommand,
  offline: offlineCommand,
};

function printReport(runId: string, labelFiles: string[], primaryReviewer: string | undefined) {
  const started = new Date().toISOString();
  const report = generateReport(runId, { labelFiles, primaryReviewer });
  recordStep(runId, {
    command: "report",
    started_at: started,
    finished_at: new Date().toISOString(),
    options: { labels: labelFiles.map((f) => repoRelative(f)), primary_reviewer: primaryReviewer ?? null },
    summary: { samples: report.results.length, labelled: report.labelled, ...report.coverage.by_status },
  });
  const statuses = Object.entries(report.coverage.by_status)
    .filter(([, n]) => n)
    .map(([status, n]) => `${n} ${status}`)
    .join(", ");
  console.log(`run ${runId}: ${report.results.length} samples (${statuses}); ${report.labelled} with human labels`);
  if (report.unmatchedLabels.length) console.log(`  ${report.unmatchedLabels.length} label(s) matched no sample in this run`);
  console.log(`  ${repoRelative(path.join(report.outDir, "index.html"))}  (comparison report)`);
  console.log(`  ${repoRelative(path.join(report.outDir, "blind.html"))}  (blind labelling)`);
  console.log(`  ${repoRelative(path.join(report.outDir, "results.json"))}, results.csv`);
}

// Parses --samples and rejects unknown IDs, so a typo can't silently select
// nothing.
function sampleSelection(knownIds: string[], value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const requested = splitList(value);
  const known = new Set(knownIds);
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length) throw new UsageError(`unknown sample ID(s): ${unknown.join(", ")}`);
  return requested;
}

function splitList(value: string | undefined) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

// Opens an existing run (defaulting to its own dataset) or creates a new one,
// after checking any --samples selection against the dataset.
function openRunFor(runOption: string | undefined, datasetOption: string | undefined, samplesOption?: string) {
  const existing = runOption && existsSync(path.join(runDir(runOption), "run.json"));
  const datasetPath = datasetOption
    ? resolveUserPath(datasetOption)
    : existing
      ? path.join(repoRoot, readRunManifest(runOption).dataset.path)
      : DEFAULT_DATASET;
  const dataset = loadDataset(datasetPath);
  const sampleIds = sampleSelection(dataset.validations.map(sampleIdOf), samplesOption);
  const runId = runOption ?? newRunId(dataset.dataset_id);
  openRun(runId, dataset);
  return { runId, dataset, sampleIds };
}

class UsageError extends Error {}

async function main() {
  // pnpm forwards a literal "--" separator; drop it.
  const [command, ...rest] = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
  const handler = command ? commands[command] : undefined;
  if (!handler) {
    console.log(USAGE);
    return command && command !== "help" ? 2 : 0;
  }
  try {
    return await handler(rest.filter((arg) => arg !== "--"));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
}

process.exitCode = await main();
