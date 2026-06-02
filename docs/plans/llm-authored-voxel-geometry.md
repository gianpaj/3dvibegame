# Plan: LLM-authored voxel geometry (replace shape templates)

## Context

A "palm tree" and a "pine tree" render identically because the LLM only emits a tiny `CreatePlan` (`shape: tree|structure|creature|cluster|marker`), and `operationsForPlan()` in `@3dvibegame/ai-planning` expands that enum into **one of 5 hardcoded geometry templates**. The LLM never authors the actual geometry, so `object_category`/`style_tags`/`key_features` are ignored for shape.

The `scene-planning-bench` prototype (`/Users/gianpaj_it/github/gianpaj/ideas/vibe-world/prototype/scene-planning-bench`) already solved this with its **VOXEL_BUILDER** path: the LLM is given the `VoxelBuilderSpec` schema and emits the **`operations` array directly** (`add_box`/`add_sphere`/`add_line`…), so each prompt produces structurally different geometry. Critically, that runtime was already ported into this repo — `scene-authority-ts` has the identical `VoxelBuilderSpec` (all 6 op kinds) plus `parseVoxelBuilderSpec` (zod-validated, `voxel-guards.ts:170`) and `compileVoxelBuilderSpec`. Only the AI-worker wiring took the template shortcut (roadmap Phase 3.8). This plan reconnects the direct-voxel path through the browser-Gemini → worker-compile pipeline we just built.

**Outcome:** the LLM authors the voxel operations per prompt; templates remain only as the offline/no-key fixture fallback. No new categories or shape vocabulary.

---

## Approach

Reshape what flows through the existing pipeline: the Gemini call returns voxel **operations** (the creative core) instead of a `CreatePlan`; the worker wraps them into a full `VoxelBuilderSpec`, grounds, validates, and compiles. To keep the LLM from inventing boilerplate (ids, grid, placement) and to keep deterministic parts deterministic, the LLM returns only the creative core; the worker assembles the envelope.

### 1. `@3dvibegame/ai-planning` — voxel prompt, core schema, assembler

**File:** `packages/ai-planning/src/contracts.ts`
- Add `voxelBuilderSystemPrompt` (port the bench's VOXEL_BUILDER prompt, `prompting.py:28`), extended with the renderer's **known material ids** (`moss_stone, wood, neon, glass_block, jelly, cloud, lava_light, void, red, stone`) so colors render (Phase 4.3 lesson), and guidance to keep objects ~2–5 grid units tall, y-up, grounded.
- Add `voxelCoreSchema` (zod) for what the LLM returns:
  ```ts
  { object_category: string, size_tier: string,
    style_tags: string[], behaviors: string[],
    materials: { material_id: string; color_hint?: string; tags?: string[] }[],
    operations: unknown[] }   // validated fully after envelope assembly
  ```
- Add `compileVoxelRequestSchema` = `{ operation: "create", source_prompt, voxel: voxelCoreSchema, warnings?: string[] }` (replaces the now-unused `compilePlanRequestSchema`).

**File:** `packages/ai-planning/src/specBuilder.ts`
- Refactor `buildVoxelSpec` to split out `assembleVoxelSpec({ sourcePrompt, objectCategory, sizeTier, styleTags, behaviors, materials, operations })` that builds the deterministic envelope (`spec_version`, hashed `request_id`/`intent_id`, `grid` `{unit_meters:0.5, up_axis:"y", rotation_step_degrees:90}`, absolute `placement`, default `anchors`, `compile_hints`, `diagnostics`) and runs the existing `groundOperations`. The current template path calls it with `operationsForPlan(...)`; the new LLM path calls it with the LLM operations.
- Add `buildVoxelResponse(request, voxelCore, warnings)` mirroring `buildCreateResponse`: `assembleVoxelSpec(...)` → `parseVoxelBuilderSpec` (validates ops, throws → `validation_failed`) → `compileVoxelBuilderSpec` → `{ status, job_id_base, object_id_base, source_spec, builder_spec, warnings }`.
- Keep `buildCreateResponse`/`operationsForPlan` for the fixture fallback path only.

### 2. `@3dvibegame/ai-worker` — `/compile` accepts voxel ops

**File:** `packages/ai-worker/src/server.ts`
- Change the `/compile` branch to parse `compileVoxelRequestSchema` and call `buildVoxelResponse(request, body.voxel, body.warnings ?? [])`. Still no LLM key needed server-side; reuse `normalizeError`/`writeJson`. (`/generate` unchanged.)
- Update the two `/compile` tests in `tests/worker.test.ts`: POST a voxel core whose `operations` are e.g. 3 boxes → assert `builder_spec.complexity.part_count === 3` (proves geometry is op-driven, not templated); and an invalid op → `validation_failed`.

### 3. `3dvibegame-web` — browser asks Gemini for operations

**File:** `packages/3dvibegame-web/src/core/aiWorker/geminiPlan.ts` → repurpose/rename to `geminiVoxel.ts`
- Use `voxelBuilderSystemPrompt`; request **JSON mode** (`responseMimeType: "application/json"`) **without** a strict `responseSchema` (Gemini's responseSchema subset can't express the op discriminated-union; the bench likewise puts the schema in the prompt and validates after). Keep the existing `parseJsonObject` resilience.
- Return the parsed voxel core (object_category/size_tier/style_tags/behaviors/materials/operations).

**File:** `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.ts`
- Call `geminiVoxel`, then POST `{ operation:"create", source_prompt, voxel: core }` to the worker `/compile`; return the compiled artifact via the existing `workerResponseToArtifact`.
- `browserGeminiAiWorkerClient.ts` (local-compile, no worker URL): assemble + compile locally via `buildVoxelResponse` so the no-worker path also gets LLM geometry.

Config wiring in `configuredAiWorkerClient.ts` is unchanged — still `browser-gemini` + optional `VITE_AI_WORKER_URL`.

### Validation / safety (reuse, don't invent)
- `parseVoxelBuilderSpec` (zod) rejects malformed ops, undeclared shapes, bad vectors → surfaced as `validation_failed`.
- `groundOperations` (existing, `specBuilder.ts:257`) lifts geometry that dips below the floor.
- The renderer already draws compiled voxel specs (the `fixtures/avatar-forest-guardian.voxel-builder.json` are this exact format), so no renderer changes.

---

## Files touched

| File | Change |
|---|---|
| `packages/ai-planning/src/contracts.ts` | `voxelBuilderSystemPrompt`, `voxelCoreSchema`, `compileVoxelRequestSchema` (replaces `compilePlanRequestSchema`) |
| `packages/ai-planning/src/specBuilder.ts` | extract `assembleVoxelSpec`, add `buildVoxelResponse` |
| `packages/ai-worker/src/server.ts` | `/compile` → `buildVoxelResponse` from voxel core |
| `packages/ai-worker/tests/worker.test.ts` | `/compile` tests assert op-count → part-count |
| `packages/3dvibegame-web/src/core/aiWorker/geminiPlan.ts` → `geminiVoxel.ts` | ask Gemini for voxel ops (JSON mode) |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.ts` | forward voxel core to `/compile` |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiAiWorkerClient.ts` | local assemble+compile via `buildVoxelResponse` |

---

## Verification

1. **Worker tests:** `pnpm --filter @3dvibegame/ai-worker test` — `/compile` returns `part_count` equal to the number of ops posted; invalid op → `validation_failed`.
2. **Typecheck:** `pnpm --filter @3dvibegame/ai-planning typecheck`, `… ai-worker typecheck`, `… 3dvibegame-web typecheck`.
3. **Web tests:** `pnpm web:test` still green (HUD tests unaffected).
4. **Manual /compile smoke:** `AI_WORKER_FAKE=1 pnpm --filter @3dvibegame/ai-worker start`, then `curl -X POST localhost:8787/compile` with a voxel core of 3 boxes → `builder_spec.complexity.part_count === 3`.
5. **End-to-end (browser, needs key):** run the worker, set `VITE_AI_WORKER_URL`, `pnpm web:dev`, enter Gemini key. Prompt "a tall palm tree" then "a round bushy oak" → the two objects are **structurally different** (different op counts/positions), confirming geometry is LLM-authored. Network tab shows the Gemini call + the `/compile` call.

> Higher-variance risk: LLM specs can be sparse or oversized. v1 relies on `parseVoxelBuilderSpec` + `groundOperations`; if needed, a follow-up can add op-count/size clamps (the bench's caps: ≤16 parts) — out of scope here.
