import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hashJson, sha256 } from "../canonical.ts";
import {
  CAPTURE_FORMAT,
  type CaptureRecord,
  type CaptureSettings,
  type CapturedView,
  type ValidatedSample,
} from "../contracts.ts";
import { readJson, writeJson } from "../files.ts";
import { cacheRoot } from "../paths.ts";
import { readCapture, readSamples, sampleDir } from "../run.ts";
import { CaptureSession, GL_BACKEND } from "./browser.ts";
import { buildCaptureApp } from "./buildApp.ts";
import { serveDirectory } from "./staticServer.ts";

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  width: 768,
  height: 768,
  device_pixel_ratio: 1,
  // Mid-light neutral grey: keeps both white and black parts distinguishable.
  background: "#aab3bf",
  fov_degrees: 35,
  framing_padding: 1.12,
  tone_mapping_exposure: 1,
  blank_threshold: 0.002,
  timeout_ms: 30_000,
  gl_backend: GL_BACKEND,
};

const captureCacheRoot = path.join(cacheRoot, "captures");

export interface CaptureSummary {
  captured: number;
  reused: number;
  resumed: number;
  failed: number;
  not_valid: number;
  failures: Array<{ sample_id: string; error: string }>;
}

export async function captureRun(
  runId: string,
  options: { reuse: boolean; sampleIds?: string[]; settings?: Partial<CaptureSettings> },
): Promise<CaptureSummary> {
  const settings = { ...DEFAULT_CAPTURE_SETTINGS, ...options.settings };
  const all = readSamples(runId).filter(
    (v) => !options.sampleIds || options.sampleIds.includes(v.status === "valid" ? v.sample.sample_id : v.meta.sample_id),
  );
  const valid = all.flatMap((v) => (v.status === "valid" ? [v.sample] : []));
  const summary: CaptureSummary = {
    captured: 0,
    reused: 0,
    resumed: 0,
    failed: 0,
    not_valid: all.length - valid.length,
    failures: [],
  };
  if (!valid.length) return summary;

  const app = await buildCaptureApp();
  const server = await serveDirectory(app.dir);
  let session: CaptureSession | null = null;
  const cleanup = async () => {
    await session?.close();
    await server.close();
  };
  const onSignal = () => {
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    session = await CaptureSession.open(server.url);
    for (const sample of valid) {
      const key = hashJson({
        format: CAPTURE_FORMAT,
        artifact_sha256: sample.artifact_sha256,
        capture_app_sha256: app.sha256,
        browser: session.browserInfo.version,
        settings,
      });
      const outcome = await captureSample(runId, sample, key, app.sha256, settings, session, options.reuse);
      summary[outcome.kind] += 1;
      if (outcome.kind === "failed") summary.failures.push({ sample_id: sample.sample_id, error: outcome.error });
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanup();
  }
  return summary;
}

async function captureSample(
  runId: string,
  sample: ValidatedSample,
  key: string,
  appSha: string,
  settings: CaptureSettings,
  session: CaptureSession,
  reuse: boolean,
): Promise<{ kind: "captured" | "reused" | "resumed" } | { kind: "failed"; error: string }> {
  const dir = sampleDir(runId, sample.sample_id);

  if (reuse) {
    // Resume: this run already holds an intact capture for the same inputs.
    const existing = readCapture(runId, sample.sample_id);
    if (existing?.status === "captured" && existing.cache_key === key && viewsIntact(dir, existing.views)) {
      return { kind: "resumed" };
    }

    const cached = readCachedCapture(key);
    if (cached) {
      for (const view of cached.views) {
        mkdirSync(path.join(dir, "views"), { recursive: true });
        copyFileSync(path.join(captureCacheRoot, key, path.basename(view.file)), path.join(dir, view.file));
      }
      writeJson(path.join(dir, "capture.json"), {
        ...cached,
        sample_id: sample.sample_id,
        reused_from: cached.captured_at,
      } satisfies CaptureRecord);
      return { kind: "reused" };
    }
  }

  const outcome = await session.capture({ builder_spec: sample.builder_spec, settings }, settings.timeout_ms);
  const record: CaptureRecord = {
    format: CAPTURE_FORMAT,
    sample_id: sample.sample_id,
    status: "capture_failed",
    error: null,
    cache_key: key,
    reused_from: null,
    artifact_sha256: sample.artifact_sha256,
    capture_app_sha256: appSha,
    page: outcome.info,
    browser: session.browserInfo,
    settings,
    bounds: null,
    views: [],
    browser_errors: outcome.browserErrors,
    capture_latency_ms: outcome.latencyMs,
    captured_at: new Date().toISOString(),
  };

  if (!outcome.ok) {
    record.error = outcome.error;
  } else {
    record.bounds = outcome.result.bounds;
    const blank = outcome.result.views.filter((v) => v.stats.foreground_fraction < settings.blank_threshold);
    if (blank.length) {
      record.error = `blank render: ${blank.map((v) => v.view_id).join(", ")} below ${settings.blank_threshold} foreground`;
    } else {
      mkdirSync(path.join(dir, "views"), { recursive: true });
      record.views = outcome.result.views.map((view): CapturedView => {
        const png = Buffer.from(view.png_base64, "base64");
        const file = `views/${view.view_id}.png`;
        writeFileSync(path.join(dir, file), png);
        return { view_id: view.view_id, label: view.label, file, sha256: sha256(png), camera: view.camera, stats: view.stats };
      });
      record.status = "captured";
    }
  }

  writeJson(path.join(dir, "capture.json"), record);
  if (record.status !== "captured") return { kind: "failed", error: record.error ?? "capture failed" };
  writeCachedCapture(key, dir, record);
  return { kind: "captured" };
}

function viewsIntact(dir: string, views: CapturedView[]) {
  return (
    views.length > 0 &&
    views.every((view) => {
      const file = path.join(dir, view.file);
      return existsSync(file) && sha256(readFileSync(file)) === view.sha256;
    })
  );
}

function readCachedCapture(key: string): CaptureRecord | null {
  const file = path.join(captureCacheRoot, key, "capture.json");
  if (!existsSync(file)) return null;
  const record = readJson<CaptureRecord>(file);
  const intact = record.views.every((view) => {
    const png = path.join(captureCacheRoot, key, path.basename(view.file));
    return existsSync(png) && sha256(readFileSync(png)) === view.sha256;
  });
  return intact ? record : null;
}

function writeCachedCapture(key: string, dir: string, record: CaptureRecord) {
  const target = path.join(captureCacheRoot, key);
  mkdirSync(target, { recursive: true });
  for (const view of record.views) copyFileSync(path.join(dir, view.file), path.join(target, path.basename(view.file)));
  writeJson(path.join(target, "capture.json"), record);
}
