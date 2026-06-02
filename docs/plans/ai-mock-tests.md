# Plan: AI tests for object drafts + edits (mocked LLM)

## Context

The create-draft and AI-edit pipelines have no automated tests — they only run live with a real Gemini key. We want CI-runnable tests that drive the **full draft + edit flow with mocked AI output**, so we catch regressions in prompt/request shape, parsing, validation, voxel assembly, compilation, and error handling without a key.

**Important architectural fact (drives the whole plan):** there are **two AI surfaces, mocked two different ways**:

| Surface | Where | How AI is called | Mock |
|---|---|---|---|
| Browser create/edit (the deployed feature) | `3dvibegame-web` `geminiVoxel.ts` | raw `fetch` to Gemini REST | **fake `fetchImpl`** (clients already accept it) |
| Worker `/generate` (create plan) | `ai-worker` `geminiPlanGenerator.ts` | `ai` SDK `generateText` + `Output.object` | **`MockLanguageModelV3`** from `ai/test` |

`MockLanguageModelV3` is the `ai`-SDK tool — it works for the **worker only**. `3dvibegame-web` doesn't depend on `ai`, so its voxel draft/edit path is mocked via `fetchImpl`. Confirmed: `ai@6.0.193` exports `MockLanguageModelV3` from `ai/test`; the worker model is currently hardcoded `google(model)` and must be made injectable.

---

## Approach

### A) Browser draft + edit tests (vitest, fake `fetchImpl`) — primary value

The browser clients (`browserGeminiAiWorkerClient` = local compile, `browserGeminiHttpCompileClient` = worker compile) and `geminiVoxel.generateVoxelCore/generateVoxelEdit` all take `fetchImpl`. We pass a fake that returns a canned Gemini `generateContent` response.

**New helper** `packages/3dvibegame-web/src/test/fakeGemini.ts`:
- `fakeGeminiFetch(coreOrText, { finishReason })` → a `typeof fetch` that returns a `Response` shaped like Gemini: `{ candidates: [{ content: { parts: [{ text: JSON.stringify(core) }] }, finishReason: "STOP" }] }`. Captures the last request body so tests can assert the prompt/spec sent.
- A small valid `VoxelCore` fixture (a few ops) + a `fakeCompileResponse(core)` for the worker-compile client.

**New tests:**
- `geminiVoxel.test.ts` — `generateVoxelCore` returns the parsed core and sends the **create** system prompt + player prompt; `generateVoxelEdit` returns the edited core and sends the **edit** system prompt + current-core JSON + change request; error paths: `finishReason: "MAX_TOKENS"`, non-JSON text, schema-invalid core → the right `AiWorkerError` codes.
- `browserGeminiAiWorkerClient.test.ts` (local compile, no worker, no key) — `createDraft({ prompt })` with a tree core → real `buildVoxelResponse` runs → assert `source_spec.object_category` and `builder_spec.complexity.part_count === ops.length`; `createEdit({ sourcePrompt: "make it red", objectContext: { sourceSpecJson } })` → assert the compiled materials include `red`. This exercises the **whole draft + edit pipeline** (mock Gemini → assemble → ground → `compileVoxelBuilderSpec`).
- `browserGeminiHttpCompileClient.test.ts` (worker compile) — fake fetch branches on URL: Gemini URL → core, `/compile` URL → `fakeCompileResponse`. Assert the client POSTs `{ operation:"create", source_prompt, voxel }` to `/compile` and returns the artifact, for both `createDraft` and `createEdit`.

Reuses existing `coreFromSourceSpec` (`geminiVoxel.ts`), `buildVoxelResponse` (`ai-planning`), `workerResponseToArtifact` (`workerResponse.ts`). No new deps.

### B) Worker `/generate` test (node:test, `MockLanguageModelV3`)

**Make the model injectable** in `packages/ai-worker/src/geminiPlanGenerator.ts`: `createGeminiPlanGenerator({ model?: LanguageModel, ... })` defaulting to `google(modelName)`, so a test can pass a mock. (Keep the env/string default behavior.)

**New test** `packages/ai-worker/tests/gemini-plan-generator.test.ts`:
- Build `new MockLanguageModelV3({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(plan) }], finishReason: { unified: "stop", raw: undefined }, usage: {...}, warnings: [] }) })`.
- `createGeminiPlanGenerator({ model: mock })` → `generateCreatePlan({ sourcePrompt })` → assert the returned `plan` matches (proves `Output.object` parsed it); feed it through `buildCreateResponse` and assert the builder spec (`object_category`, `part_count > 0`).
- Optional: run the real `createAiWorkerHandler` with a `planGenerator` backed by the mock model and POST `/generate`, asserting the completed response.

Complements the existing `createStaticPlanGenerator` (a hardcoded fake) with a flexible, SDK-accurate mock.

---

## Files touched

| File | Change |
|---|---|
| `packages/3dvibegame-web/src/test/fakeGemini.ts` | *(new)* fake Gemini fetch + fixtures |
| `packages/3dvibegame-web/src/core/aiWorker/geminiVoxel.test.ts` | *(new)* create/edit prompt + parse/error tests |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiAiWorkerClient.test.ts` | *(new)* draft + edit through real local compile |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.test.ts` | *(new)* draft + edit through `/compile` (mock both) |
| `packages/ai-worker/src/geminiPlanGenerator.ts` | make `model` injectable (keep default) |
| `packages/ai-worker/tests/gemini-plan-generator.test.ts` | *(new)* `MockLanguageModelV3` plan → builder spec |

---

## Verification

1. `pnpm web:test` — new vitest suites pass alongside the existing 21 tests; no Gemini key, no network.
2. `pnpm --filter @3dvibegame/ai-worker test` — the `MockLanguageModelV3` test passes.
3. `pnpm --filter @3dvibegame/3dvibegame-web typecheck` and `… ai-worker typecheck` clean.
4. Determinism: canned cores → same compiled `part_count` / material set every run.

> Note: these mock the LLM **plumbing** (request shape, parsing, validation, assembly, compile, errors), not real model output quality. The `smoke:gemini-live` / live-browser smokes remain the (key-gated) real-LLM checks.
