import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CaptureSession } from "../src/capture/browser.ts";
import { buildCaptureApp } from "../src/capture/buildApp.ts";
import { captureRun, DEFAULT_CAPTURE_SETTINGS } from "../src/capture/index.ts";
import { serveDirectory } from "../src/capture/staticServer.ts";
import type { CaptureRecord, ViewStats } from "../src/contracts.ts";
import { loadDataset } from "../src/dataset.ts";
import { evalsRoot } from "../src/paths.ts";
import { openRun, readCapture } from "../src/run.ts";

// Browser smoke for the capture pipeline (needs Chromium: `pnpm test:browser`).
// Asserts on image statistics, not bytes, so it holds across machines.

const dataset = loadDataset(path.join(evalsRoot, "fixtures", "manifest.json"));
const validIds = dataset.validations.flatMap((v) => (v.status === "valid" ? [v.sample.sample_id] : []));

function capture(runId: string, sampleId: string): CaptureRecord {
  const record = readCapture(runId, sampleId);
  expect(record, sampleId).not.toBeNull();
  return record!;
}

function stats(record: CaptureRecord, viewId: string): ViewStats {
  return record.views.find((v) => v.view_id === viewId)!.stats;
}

describe("capture pipeline", () => {
  beforeAll(async () => {
    openRun("smoke-a", dataset);
    openRun("smoke-b", dataset);
    const first = await captureRun("smoke-a", { reuse: false });
    expect(first.failures).toEqual([]);
    expect(first.captured).toBe(validIds.length);
    expect(first.not_valid).toBe(dataset.validations.length - validIds.length);
    await captureRun("smoke-b", { reuse: false });
  });

  it("saves three labelled views with provenance for every valid sample", () => {
    for (const id of validIds) {
      const record = capture("smoke-a", id);
      expect(record.status).toBe("captured");
      expect(record.views.map((v) => v.view_id)).toEqual(["front_three_quarter", "opposite_three_quarter", "elevated"]);
      expect(record.page?.three_revision).toMatch(/^\d+$/);
      expect(record.page?.tone_mapping).toBe("ACESFilmicToneMapping");
      expect(record.browser.version).toBeTruthy();
      expect(record.capture_app_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(record.bounds).not.toBeNull();
    }
  });

  it("frames every object fully inside the image with consistent fill", () => {
    for (const id of validIds) {
      for (const view of capture("smoke-a", id).views) {
        const box = view.stats.foreground_bbox!;
        expect(box.x0, `${id}/${view.view_id}`).toBeGreaterThan(0);
        expect(box.y0).toBeGreaterThan(0);
        expect(box.x1).toBeLessThan(1);
        expect(box.y1).toBeLessThan(1);
        expect(Math.max(box.x1 - box.x0, box.y1 - box.y0), `${id}/${view.view_id}`).toBeGreaterThan(0.6);
      }
    }
  });

  it("keeps extreme aspect ratios filling their long axis", () => {
    const pole = stats(capture("smoke-a", "tall-flagpole"), "front_three_quarter").foreground_bbox!;
    expect(pole.y1 - pole.y0).toBeGreaterThan(0.75);
    expect(pole.x1 - pole.x0).toBeLessThan(0.4);
    const rug = stats(capture("smoke-a", "flat-rug"), "front_three_quarter").foreground_bbox!;
    expect(rug.x1 - rug.x0).toBeGreaterThan(0.75);
  });

  it("renders material colours, including color_hint overrides", () => {
    // jelly + color_hint "yellow"
    for (const view of capture("smoke-a", "yellow-jelly-blob").views) {
      expect(view.stats.hue_histogram.yellow ?? 0).toBeGreaterThan(0.9);
    }
    for (const view of capture("smoke-a", "barrel-triangle").views) {
      expect(view.stats.hue_histogram.red ?? 0).toBeGreaterThan(0.9);
    }
    // Every swatch colour, including the hex color_hint (#ff8800), is visible.
    const swatch = stats(capture("smoke-a", "color-swatch"), "front_three_quarter").hue_histogram;
    const share = (...buckets: string[]) => buckets.reduce((sum, b) => sum + (swatch[b] ?? 0), 0);
    expect(share("red")).toBeGreaterThan(0.04);
    expect(share("orange")).toBeGreaterThan(0.04);
    expect(share("yellow")).toBeGreaterThan(0.04);
    expect(share("green", "spring", "chartreuse")).toBeGreaterThan(0.04);
    expect(share("blue", "azure")).toBeGreaterThan(0.04);
    expect(share("neutral_light")).toBeGreaterThan(0.04);
    expect(share("neutral_dark")).toBeGreaterThan(0.04);
  });

  it("preserves framing and appearance across repeated captures", () => {
    for (const id of validIds) {
      const a = capture("smoke-a", id);
      const b = capture("smoke-b", id);
      expect(b.views.map((v) => v.camera)).toEqual(a.views.map((v) => v.camera));
      b.views.forEach((view, i) => {
        const before = a.views[i]!.stats;
        expect(Math.abs(view.stats.foreground_fraction - before.foreground_fraction)).toBeLessThan(0.002);
        for (const key of ["x0", "y0", "x1", "y1"] as const) {
          expect(Math.abs(view.stats.foreground_bbox![key] - before.foreground_bbox![key])).toBeLessThan(0.005);
        }
      });
    }
  });

  it("reuses cached captures when nothing relevant changed", async () => {
    openRun("smoke-c", dataset);
    const summary = await captureRun("smoke-c", { reuse: true, sampleIds: ["pine-tree"] });
    expect(summary.reused).toBe(1);
    expect(capture("smoke-c", "pine-tree").reused_from).not.toBeNull();
  });

  it("treats a blank render as a capture failure", async () => {
    openRun("smoke-blank", dataset);
    // An impossible threshold makes every view count as blank.
    const summary = await captureRun("smoke-blank", {
      reuse: false,
      sampleIds: ["pine-tree"],
      settings: { blank_threshold: 2 },
    });
    expect(summary.failed).toBe(1);
    const record = capture("smoke-blank", "pine-tree");
    expect(record.status).toBe("capture_failed");
    expect(record.error).toMatch(/blank render/);
    expect(record.views).toEqual([]);
  });
});

describe("capture session", () => {
  let session: CaptureSession;
  let server: Awaited<ReturnType<typeof serveDirectory>>;

  beforeAll(async () => {
    const app = await buildCaptureApp();
    server = await serveDirectory(app.dir);
    session = await CaptureSession.open(server.url);
  });

  afterAll(async () => {
    await session?.close();
    await server?.close();
  });

  it("reports page-side errors instead of images", async () => {
    const outcome = await session.capture({ builder_spec: {}, settings: DEFAULT_CAPTURE_SETTINGS }, 30_000);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(/TypeError/);
  });

  it("enforces the timeout", async () => {
    const outcome = await session.capture({ builder_spec: {}, settings: DEFAULT_CAPTURE_SETTINGS }, 1);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(/timed? ?out|Timeout/i);
  });
});
