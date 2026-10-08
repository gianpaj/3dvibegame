import path from "node:path";

import { describe, expect, it } from "vitest";

import { establishQuantity, fileJsonReader, loadDataset, validateDataset } from "../src/dataset.ts";
import { readJson } from "../src/files.ts";
import { evalsRoot } from "../src/paths.ts";

const fixtureManifest = path.join(evalsRoot, "fixtures", "manifest.json");
const fixtureDir = path.dirname(fixtureManifest);

interface RawSample {
  sample_id: string;
  fixture_expectation: string;
  [key: string]: unknown;
}

function fixtureSamples(): RawSample[] {
  return readJson<{ samples: RawSample[] }>(fixtureManifest).samples;
}

function validSample(overrides: Record<string, unknown> = {}) {
  const base = fixtureSamples().find((s) => s.sample_id === "pine-tree")!;
  const { fixture_expectation: _ignored, ...rest } = base;
  return { ...rest, ...overrides };
}

describe("synthetic fixtures", () => {
  it("validate offline with the outcome each fixture declares", () => {
    const dataset = loadDataset(fixtureManifest);
    const expected = new Map(fixtureSamples().map((s) => [s.sample_id, s.fixture_expectation]));
    for (const v of dataset.validations) {
      const id = v.status === "valid" ? v.sample.sample_id : v.meta.sample_id;
      const actual = v.status === "valid" ? "valid" : `input_invalid:${v.issue}`;
      expect(actual, `${id}: ${v.status === "valid" ? "" : v.reasons.join("; ")}`).toBe(expected.get(id));
    }
    expect(dataset.validations).toHaveLength(expected.size);
  });

  it("give every invalid sample an explicit reason", () => {
    for (const v of loadDataset(fixtureManifest).validations) {
      if (v.status === "input_invalid") expect(v.reasons.length).toBeGreaterThan(0);
    }
  });

  it("hash the stored artifact so equal specs share an identity", () => {
    const valid = loadDataset(fixtureManifest).validations.flatMap((v) => (v.status === "valid" ? [v.sample] : []));
    const hashes = new Set(valid.map((s) => s.artifact_sha256));
    expect(hashes.size).toBe(valid.length);
  });
});

describe("sample validation", () => {
  const reader = fileJsonReader(fixtureDir);

  it("rejects unknown fields such as player identifiers", () => {
    const [v] = validateDataset([validSample({ player_nickname: "alice" })], reader);
    expect(v!.status).toBe("input_invalid");
    expect(v!.status === "input_invalid" && v!.issue).toBe("malformed");
  });

  it("refuses spec paths that escape the manifest directory", () => {
    const [v] = validateDataset([validSample({ builder_spec_path: "../../../package.json" })], reader);
    expect(v!.status === "input_invalid" && v!.reasons.join()).toMatch(/escapes the manifest directory/);
  });

  it("treats an empty-volume spec as an artifact failure, not malformed input", () => {
    const spec = readJson<{ parts: Array<{ dimensions: number[] }> }>(
      path.join(fixtureDir, "specs/pine-tree.builder.json"),
    );
    spec.parts.forEach((part) => (part.dimensions = [0, 1, 1]));
    const { builder_spec_path: _p, ...rest } = validSample();
    const [v] = validateDataset([{ ...rest, builder_spec: spec }], reader);
    expect(v!.status === "input_invalid" && v!.issue).toBe("artifact_failure");
  });

  it("requires a human attribute decision and a privacy review for imports", () => {
    const [v] = validateDataset(
      [
        validSample({
          visual_attributes_applicable: null,
          provenance: { kind: "feedback_export", privacy_reviewed: false },
        }),
      ],
      reader,
    );
    expect(v!.status === "input_invalid" && v!.issue).toBe("needs_curation");
    expect(v!.status === "input_invalid" && v!.reasons).toHaveLength(2);
  });

  it("flags duplicate sample IDs", () => {
    const results = validateDataset([validSample(), validSample()], reader);
    for (const v of results) {
      expect(v.status === "input_invalid" && v.reasons.join()).toMatch(/duplicate sample_id/);
    }
  });

  it("flags a prompt family that spans development and holdout", () => {
    const results = validateDataset(
      [validSample(), validSample({ sample_id: "pine-tree-2", split: "holdout" })],
      reader,
    );
    for (const v of results) {
      expect(v.status === "input_invalid" && v.reasons.join()).toMatch(/both development and holdout/);
    }
  });

  it("warns that unassigned samples are excluded from calibration", () => {
    const [v] = validateDataset([validSample({ split: "unassigned" })], reader);
    expect(v!.status === "valid" && v!.warnings.join()).toMatch(/unassigned/);
  });
});

describe("establishQuantity", () => {
  it("uses explicit manifest metadata", () => {
    expect(establishQuantity(1, null)).toEqual({ kind: "single" });
    expect(establishQuantity(2, null)).toEqual({ kind: "multiple", value: 2 });
  });

  it("defaults a raw voxel core without quantity to one object", () => {
    expect(establishQuantity(null, { operations: [] })).toEqual({ kind: "single" });
  });

  it("can't establish scope from a compiled VoxelBuilderSpec", () => {
    expect(establishQuantity(null, { spec_version: "0.1", operations: [] })).toEqual({ kind: "unknown" });
    expect(establishQuantity(null, null)).toEqual({ kind: "unknown" });
  });

  it("reports conflicting evidence", () => {
    expect(establishQuantity(1, { operations: [], quantity: 3 }).kind).toBe("conflict");
  });
});
