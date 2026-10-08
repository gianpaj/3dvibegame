import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { builderSpecSchema } from "../src/builder-guards.ts";
import type { BuilderSpec } from "../src/contracts.ts";
import { compileVoxelBuilderSpec } from "../src/voxel-compiler.ts";
import { parseVoxelBuilderSpec } from "../src/voxel-guards.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixtureDir = "packages/scene-runtime-demo/src/fixtures";

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, fixtureDir, name), "utf8"));
}

test("builder spec schema accepts committed builder fixtures", () => {
  for (const name of ["pine-tree.builder.json", "barrel-triangle.builder.json"]) {
    const result = builderSpecSchema.safeParse(readFixture(name));
    assert.ok(result.success, `${name}: ${result.error?.message}`);
  }
});

test("builder spec schema accepts compiler output", () => {
  const voxel = parseVoxelBuilderSpec(readFixture("pine-tree.voxel-builder.json"));
  const compiled: BuilderSpec = compileVoxelBuilderSpec(voxel);
  assert.ok(builderSpecSchema.safeParse(compiled).success);
});

test("builder spec schema rejects malformed parts", () => {
  const spec = readFixture("pine-tree.builder.json") as { parts: Array<Record<string, unknown>> };
  spec.parts[0]!.dimensions = [1, "tall", 1];
  const result = builderSpecSchema.safeParse(spec);
  assert.equal(result.success, false);
  assert.deepEqual(result.error?.issues[0]?.path, ["parts", 0, "dimensions", 1]);
});

test("builder spec schema rejects non-finite numbers", () => {
  const spec = readFixture("pine-tree.builder.json") as { parts: Array<Record<string, unknown>> };
  spec.parts[0]!.dimensions = [1, Number.POSITIVE_INFINITY, 1];
  assert.equal(builderSpecSchema.safeParse(spec).success, false);
});
