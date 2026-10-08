import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { existsSync } from "node:fs";

import { captureRun } from "./capture/index.ts";
import { loadDataset } from "./dataset.ts";
import { writeJson } from "./files.ts";
import { importFeedbackRows } from "./importFeedback.ts";
import { evalsRoot, repoRelative, repoRoot, resolveUserPath, tmpRoot } from "./paths.ts";
import { newRunId, openRun, readRunManifest, recordStep, runDir } from "./run.ts";

const DEFAULT_DATASET = path.join(evalsRoot, "fixtures", "manifest.json");

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
`;

type Handler = (argv: string[]) => Promise<number>;

const commands: Record<string, Handler> = {
  validate: async (argv) => {
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
  },

  "import-feedback": async (argv) => {
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
  },

  capture: async (argv) => {
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
    const { runId } = openRunFor(values.run, values.dataset);
    const sampleIds = values.samples?.split(",").map((id) => id.trim()).filter(Boolean);
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
  },
};

// Opens an existing run (defaulting to its own dataset) or creates a new one.
function openRunFor(runOption: string | undefined, datasetOption: string | undefined) {
  const existing = runOption && existsSync(path.join(runDir(runOption), "run.json"));
  const datasetPath = datasetOption
    ? resolveUserPath(datasetOption)
    : existing
      ? path.join(repoRoot, readRunManifest(runOption).dataset.path)
      : DEFAULT_DATASET;
  const dataset = loadDataset(datasetPath);
  const runId = runOption ?? newRunId(dataset.dataset_id);
  openRun(runId, dataset);
  return { runId, dataset };
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
