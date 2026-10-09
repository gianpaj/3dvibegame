import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sha256 } from "../src/canonical.ts";
import { CAPTURE_FORMAT, type CaptureRecord, type ValidatedSample } from "../src/contracts.ts";
import { loadDataset } from "../src/dataset.ts";
import { writeJson } from "../src/files.ts";
import type { ClientResult, DecisionsClient } from "../src/judge/client.ts";
import type { DecisionRequest } from "../src/judge/request.ts";
import { evalsRoot } from "../src/paths.ts";
import { openRun, sampleDir } from "../src/run.ts";

export const fixtureManifest = path.join(evalsRoot, "fixtures", "manifest.json");

const VIEWS = [
  ["front_three_quarter", "View 1 of 3: front three-quarter"],
  ["opposite_three_quarter", "View 2 of 3: opposite three-quarter"],
  ["elevated", "View 3 of 3: elevated"],
] as const;

// Creates a run from the fixture dataset with fake (non-PNG) view files, so
// judge and report tests need no browser. `imageSeed` controls image bytes:
// equal seeds give equal image hashes, which matters for result reuse.
export function fabricateCapturedRun(runId: string, imageSeed: string = runId, failIds: string[] = []) {
  const dataset = loadDataset(fixtureManifest);
  openRun(runId, dataset);
  const samples: ValidatedSample[] = [];
  for (const v of dataset.validations) {
    if (v.status !== "valid") continue;
    samples.push(v.sample);
    const dir = sampleDir(runId, v.sample.sample_id);
    const failed = failIds.includes(v.sample.sample_id);
    const views = failed
      ? []
      : VIEWS.map(([view_id, label]) => {
          const bytes = Buffer.from(`${imageSeed}:${v.sample.sample_id}:${view_id}`);
          const file = `views/${view_id}.png`;
          mkdirSync(path.join(dir, "views"), { recursive: true });
          writeFileSync(path.join(dir, file), bytes);
          return {
            view_id,
            label,
            file,
            sha256: sha256(bytes),
            camera: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov_degrees: 35, near: 0.1, far: 20 },
            stats: { foreground_fraction: 0.2, foreground_bbox: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, hue_histogram: {} },
          } satisfies CaptureRecord["views"][number];
        });
    writeJson(path.join(dir, "capture.json"), {
      format: CAPTURE_FORMAT,
      sample_id: v.sample.sample_id,
      status: failed ? "capture_failed" : "captured",
      error: failed ? "blank render: front_three_quarter" : null,
      cache_key: `fake-${imageSeed}`,
      reused_from: null,
      artifact_sha256: v.sample.artifact_sha256,
      capture_app_sha256: "fake",
      page: null,
      browser: { name: "chromium", version: "test", playwright: "test" },
      settings: {
        width: 64, height: 64, device_pixel_ratio: 1, background: "#aab3bf", fov_degrees: 35,
        framing_padding: 1.12, tone_mapping_exposure: 1, blank_threshold: 0.002, timeout_ms: 1000, gl_backend: "test",
      },
      bounds: failed ? null : { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
      views,
      browser_errors: [],
      capture_latency_ms: 12,
      captured_at: "2026-10-08T00:00:00.000Z",
    } satisfies CaptureRecord);
  }
  return samples;
}

export function scoreAnswer(name: string, probabilities = [0.05, 0.1, 0.25, 0.6], labels?: string[]) {
  return {
    type: "score",
    name,
    score: probabilities.reduce((sum, p, i) => sum + i * p, 0),
    confidence: Math.max(...probabilities),
    probabilities: probabilities.map((probability, value) => ({
      value,
      probability,
      ...(labels ? { label: labels[value] } : {}),
    })),
  };
}

export function okResponse(request: DecisionRequest, inputTokens = 4_000): ClientResult {
  return {
    kind: "http",
    status: 200,
    retryAfterMs: null,
    body: {
      model: "gpt-6-luna-2026-09-30",
      answers: request.questions.map((q) => scoreAnswer(q.name, undefined, q.levels.map((l) => l.label))),
      usage: { input_tokens: inputTokens, output_tokens: 0, total_tokens: inputTokens },
    },
  };
}

// Live-like client (mock: false) answering from a script.
export class ScriptedClient implements DecisionsClient {
  readonly mock = false;
  readonly calls: DecisionRequest[] = [];

  constructor(private readonly respond: (request: DecisionRequest, call: number) => ClientResult | Promise<ClientResult>) {}

  async send(request: DecisionRequest): Promise<ClientResult> {
    this.calls.push(request);
    return this.respond(request, this.calls.length - 1);
  }
}
