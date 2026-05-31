import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { BuilderSpec } from "../src/contracts.ts";
import { compileVoxelBuilderSpec } from "../src/voxel-compiler.ts";
import type { VoxelBuilderSpec, VoxelVector3 } from "../src/voxel-contracts.ts";
import { parseVoxelBuilderSpec } from "../src/voxel-guards.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const parityCases = [
  {
    label: "pine tree create",
    voxelFixture: "packages/scene-runtime-demo/src/fixtures/pine-tree.voxel-builder.json",
    expectedBuilderFixture:
      "packages/scene-runtime-demo/src/fixtures/pine-tree.builder.json",
  },
  {
    label: "pine tree refine",
    voxelFixture:
      "packages/scene-runtime-demo/src/fixtures/pine-tree-edit.voxel-builder.json",
    expectedBuilderFixture:
      "packages/scene-runtime-demo/src/fixtures/pine-tree-edit.builder.json",
  },
  {
    label: "barrel triangle clone layout",
    voxelFixture:
      "packages/scene-runtime-demo/src/fixtures/barrel-triangle.voxel-builder.json",
    expectedBuilderFixture:
      "packages/scene-runtime-demo/src/fixtures/barrel-triangle.builder.json",
  },
] as const;

test("voxel compiler stays compatible with builder benchmark fixture expectations", () => {
  for (const parityCase of parityCases) {
    const actual = compileFixture(parityCase.voxelFixture);
    const expected = readJson<BuilderSpec>(parityCase.expectedBuilderFixture);

    assertBenchmarkCompatible(actual, expected, parityCase.label);
  }
});

test("voxel compiler output is deterministic for builder benchmark fixtures", () => {
  for (const parityCase of parityCases) {
    const first = compileFixture(parityCase.voxelFixture);
    const second = compileFixture(parityCase.voxelFixture);

    assert.deepEqual(first, second, `${parityCase.label}: deterministic compile`);
  }
});

function compileFixture(relativePath: string): BuilderSpec {
  return compileVoxelBuilderSpec(
    parseVoxelBuilderSpec(readJson<VoxelBuilderSpec>(relativePath)),
  );
}

function assertBenchmarkCompatible(
  actual: BuilderSpec,
  expected: BuilderSpec,
  label: string,
) {
  assert.equal(actual.builder_version, expected.builder_version, `${label}: version`);
  assert.equal(actual.request_id, expected.request_id, `${label}: request_id`);
  assert.equal(actual.intent_id, expected.intent_id, `${label}: intent_id`);
  assert.equal(actual.operation, expected.operation, `${label}: operation`);
  assert.equal(
    actual.target_object_id ?? null,
    expected.target_object_id ?? null,
    `${label}: target_object_id`,
  );
  assert.equal(
    actual.base_object_version ?? null,
    expected.base_object_version ?? null,
    `${label}: base_object_version`,
  );
  assert.equal(
    actual.object_category,
    expected.object_category,
    `${label}: object_category`,
  );
  assert.equal(actual.size_tier, expected.size_tier, `${label}: size_tier`);
  assert.deepEqual(actual.placement, expected.placement, `${label}: placement`);
  assert.deepEqual(actual.complexity, expected.complexity, `${label}: complexity`);
  assert.deepEqual(
    sorted(actual.materials),
    sorted(expected.materials),
    `${label}: materials`,
  );
  assert.deepEqual(
    sorted(actual.behaviors),
    sorted(expected.behaviors),
    `${label}: behaviors`,
  );

  assert.equal(actual.parts.length, expected.parts.length, `${label}: part count`);
  expected.parts.forEach((expectedPart, index) => {
    const actualPart = actual.parts[index];
    assert.ok(actualPart, `${label}: missing part ${index}`);
    assert.equal(
      actualPart.primitive,
      expectedPart.primitive,
      `${label}: part ${index} primitive`,
    );
    assert.equal(
      actualPart.material,
      expectedPart.material,
      `${label}: part ${index} material`,
    );
    assertVectorClose(
      actualPart.dimensions,
      expectedPart.dimensions,
      `${label}: part ${index} dimensions`,
    );

    expectedPart.modifiers.forEach((modifier) => {
      assert.ok(
        actualPart.modifiers.includes(modifier),
        `${label}: part ${index} missing modifier ${modifier}`,
      );
    });
  });

  assert.equal(
    actual.instances.length,
    expected.instances.length,
    `${label}: instance count`,
  );
  expected.instances.forEach((expectedInstance, index) => {
    const actualInstance = actual.instances[index];
    assert.ok(actualInstance, `${label}: missing instance ${index}`);
    assert.equal(
      actualInstance.anchor_mode,
      expectedInstance.anchor_mode,
      `${label}: instance ${index} anchor_mode`,
    );
    assert.equal(
      actualInstance.reference_object ?? null,
      expectedInstance.reference_object ?? null,
      `${label}: instance ${index} reference_object`,
    );
    assert.equal(
      actualInstance.relation ?? null,
      expectedInstance.relation ?? null,
      `${label}: instance ${index} relation`,
    );
    assertVectorClose(
      actualInstance.offset,
      expectedInstance.offset,
      `${label}: instance ${index} offset`,
    );
  });
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as T;
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function assertVectorClose(
  actual: VoxelVector3,
  expected: VoxelVector3,
  label: string,
) {
  assert.equal(actual.length, expected.length, `${label}: vector length`);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 0.001,
      `${label}[${index}]: expected ${expected[index]}, got ${value}`,
    );
  });
}
