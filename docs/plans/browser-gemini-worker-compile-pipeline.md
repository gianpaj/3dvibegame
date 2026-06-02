# Plan: Browser-Gemini + Worker-Compile pipeline

## Context

Today the browser-Gemini path does **two** jobs locally: (1) calls Gemini with the user's BYOK key to get a `CreatePlan`, and (2) runs the deterministic `buildCreateResponse` converter (`@3dvibegame/ai-planning`) to turn that plan into a voxel builder spec. The converter only has 5 hardcoded shape templates (`tree`, `structure`, `creature`, `cluster`, default), so a "palm tree" and a "pine tree" both render as the same tree template.

We want to **split the pipeline** so the geometry-assembly half runs on the `ai-worker` server, while the LLM call stays in the browser under the user's control:

```
browser → Gemini (BYOK key, stays in browser) → CreatePlan JSON
browser → POST plan to ai-worker /compile → worker runs buildCreateResponse → builder_spec
browser → renders builder_spec
```

**Why:** The converter (geometry templates, future richer generation, validation, guardrails) belongs on the server boundary per the roadmap's "LLM for intent parsing; deterministic engine assembly". Moving it server-side means geometry improvements ship without redeploying the client, and the API key never leaves the browser. This is option 2 from the prior discussion, modified so the **browser** owns the Gemini call rather than the worker.

---

## Approach

### 1. `@3dvibegame/ai-planning` — add a shared compile-request schema

**File:** `packages/ai-planning/src/contracts.ts`

Add a schema so both the worker and the browser client validate the same shape:

```ts
export const compilePlanRequestSchema = z.object({
  operation: z.literal("create"),
  source_prompt: z.string().trim().min(1).max(1_000),
  plan: createPlanSchema,
  warnings: z.array(z.string()).max(10).optional(),
});
export type CompilePlanRequest = z.infer<typeof compilePlanRequestSchema>;
```

`createPlanSchema` and `aiWorkerRequestSchema` already exist here; reuse `createPlanSchema` verbatim. Exported automatically via the `export *` barrel in `src/index.ts`.

### 2. `@3dvibegame/ai-worker` — add `POST /compile` endpoint

**File:** `packages/ai-worker/src/server.ts`

Add a branch in `handleAiWorkerRequest` (and the matching `OPTIONS /compile` preflight) that:
- parses the body with `compilePlanRequestSchema`
- builds the `AiWorkerRequest` envelope (`{ operation: "create", source_prompt, target_object_id: null, base_object_version: null, object_context: null }`)
- calls `buildCreateResponse(request, body.plan, body.warnings ?? [])` — the **same** function `/generate` already uses
- writes the result via the existing `writeJson` helper

Reuse the existing `applyCors`, `writeJson`, `readJsonBody`, `normalizeError`, `failure` helpers. No `planGenerator` / Gemini dependency on this path — `/compile` works even with no API key configured on the server. `/generate` stays unchanged for the full server-side path.

Add a test in `packages/ai-worker/tests/worker.test.ts` mirroring the existing create test: POST a known plan to `/compile`, assert `status: "completed"` and `part_count > 0`.

### 3. `3dvibegame-web` — new browser client that compiles via the worker

**New file:** `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.ts`

A client implementing `AiWorkerClient` whose `createDraft`:
1. Calls Gemini for the plan — reuse the existing Gemini call. **Refactor** `browserGeminiAiWorkerClient.ts` to export its private `generateCreatePlan` helper (or extract it into a small shared `geminiPlan.ts` module) so both clients share the exact same request/schema/timeout logic.
2. Validates with `createPlanSchema.safeParse` (fast local failure before the round trip).
3. POSTs `{ operation: "create", source_prompt, plan }` to `${workerUrl}/compile`.
4. Parses the worker response into an `AiWorkerArtifact` — **reuse the response-parsing/error helpers already in `httpAiWorkerClient.ts`** (`parseWorkerResponse`, `toArtifact`, `workerErrorCode`, timeout/abort handling). Extract those into a shared `workerResponse.ts` module so both `httpAiWorkerClient.ts` and the new client use them (avoids duplication).

`createEdit` throws `unsupported_request` (same as the existing browser-Gemini client).

### 4. `3dvibegame-web` — wire the new client into config

**File:** `packages/3dvibegame-web/src/core/aiWorker/configuredAiWorkerClient.ts`

In `browser-gemini` mode, when `VITE_AI_WORKER_URL` is set, return the new `browserGeminiHttpCompileClient` (Gemini in browser + compile on worker). When `VITE_AI_WORKER_URL` is **absent**, fall back to the current local-compile `browserGeminiAiWorkerClient` (keeps offline dev working). This keeps a single `browser-gemini` mode; the worker URL is the only new knob.

> Alternative (if you prefer explicit over auto-routing): add a distinct mode string `browser-gemini-worker` instead of reusing `browser-gemini` + URL presence. I recommend the auto-route version for the simpler deployment story — set one env var and you're done.

**File:** `packages/3dvibegame-web/.env.example` — document:
```
VITE_AI_CLIENT_MODE=browser-gemini
# When set, the browser calls Gemini for the plan and the worker compiles geometry.
# When unset, geometry is compiled locally in the browser.
VITE_AI_WORKER_URL=http://localhost:8787
```

### 5. `3dvibegame-web` — UI component tests (vitest + Testing Library)

First vitest setup in the monorepo (existing packages use `node:test`). All 6 components in `src/components/` are pure presentational and easy to cover.

**Dev deps** (add to `packages/3dvibegame-web/package.json`):
```
vitest ^3, jsdom ^25,
@testing-library/react ^16, @testing-library/dom ^10,
@testing-library/jest-dom ^6, @testing-library/user-event ^14
```
(`@testing-library/react` v16 is the React 19-compatible line; `@vitejs/plugin-react` is already present.)

**Config** — add a `test` block to `vite.config.ts` (single config, shared with the dev build):
```ts
/// <reference types="vitest/config" />
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"] },
});
```
Add the matching `@/*` → `src/*` path to `tsconfig.json` `compilerOptions.paths` so the alias works in the example's import style.

**New file** `src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

**Test files** — colocate as `src/components/<Name>.test.tsx`. Coverage per component:
- `StatusBadge.test.tsx` — `idle` → text "Ready" with class `badge-idle`; `grace` → "Review" with `badge-grace`.
- `ConnectionStatus.test.tsx` — `connected` → "Live" with `conn-live`; `title` shows the message.
- `PlayerList.test.tsx` — renders only `active` players; local player shows "You"; returns nothing when no active players.
- `PromptInput.test.tsx` — submit button disabled when empty/disabled; typing + Enter calls `onSubmit` with trimmed text and clears (use `@testing-library/user-event`).
- `GeminiKeyModal.test.tsx` — empty submit shows the error; valid submit calls `onSave` with the key.
- `GenerationCard.test.tsx` — returns nothing at `idle`; at `grace` with all `availableActions` shows Move/Rotate/Scale + "Release to world"; at `released` the release button reads "Done"; clicking a button calls `onDispatch` with the right action id.

**Scripts** — add to `packages/3dvibegame-web/package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`. Add root `"web:test": "pnpm --filter @3dvibegame/3dvibegame-web test"`.

---

## Files touched

| File | Change |
|---|---|
| `packages/ai-planning/src/contracts.ts` | add `compilePlanRequestSchema` |
| `packages/ai-worker/src/server.ts` | add `POST /compile` + `OPTIONS /compile` |
| `packages/ai-worker/tests/worker.test.ts` | add `/compile` test |
| `packages/3dvibegame-web/src/core/aiWorker/geminiPlan.ts` | *(new)* extracted shared Gemini-plan call |
| `packages/3dvibegame-web/src/core/aiWorker/workerResponse.ts` | *(new)* extracted shared worker-response parsing |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiAiWorkerClient.ts` | use shared `geminiPlan.ts` |
| `packages/3dvibegame-web/src/core/aiWorker/httpAiWorkerClient.ts` | use shared `workerResponse.ts` |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.ts` | *(new)* the hybrid client |
| `packages/3dvibegame-web/src/core/aiWorker/configuredAiWorkerClient.ts` | route to hybrid client when `VITE_AI_WORKER_URL` set |
| `packages/3dvibegame-web/.env.example` | document `VITE_AI_WORKER_URL` |
| `packages/3dvibegame-web/package.json` | add vitest + Testing Library dev deps, `test`/`test:watch` scripts |
| `packages/3dvibegame-web/vite.config.ts` | add `test` block, `@/*` alias |
| `packages/3dvibegame-web/tsconfig.json` | add `@/*` path mapping |
| `packages/3dvibegame-web/src/test/setup.ts` | *(new)* jest-dom matchers |
| `packages/3dvibegame-web/src/components/*.test.tsx` | *(new)* 6 component test files |
| `package.json` (root) | add `web:test` script |

---

## Verification

1. **Worker unit test:** `pnpm --filter @3dvibegame/ai-worker test` — new `/compile` test passes.
2. **Worker smoke (manual):** `AI_WORKER_FAKE=1 pnpm --filter @3dvibegame/ai-worker start`, then `curl -X POST localhost:8787/compile -d '{"operation":"create","source_prompt":"palm tree","plan":{...valid CreatePlan...}}'` → returns `status: "completed"` with a builder spec. Confirms `/compile` needs no API key.
3. **Typecheck:** `pnpm --filter @3dvibegame/3dvibegame-web typecheck` and `pnpm --filter @3dvibegame/ai-worker typecheck` are clean.
3a. **UI tests:** `pnpm web:test` — all 6 component test suites pass under vitest/jsdom.
4. **End-to-end (browser):** run the worker (`pnpm --filter @3dvibegame/ai-worker start`), set `VITE_AI_WORKER_URL=http://localhost:8787` in `packages/3dvibegame-web/.env.local`, `pnpm web:dev`. Enter the Gemini key, prompt "create a palm tree". In devtools Network tab confirm: one request to `generativelanguage.googleapis.com` (browser→Gemini) **and** one to `localhost:8787/compile` (browser→worker). Object appears in the scene.
5. **Fallback:** unset `VITE_AI_WORKER_URL`, repeat — only the Gemini request fires, geometry compiles locally, object still appears.

> Note: this change does **not** by itself make a palm tree look different from a pine tree — both still map to `shape: "tree"`. It moves compilation to the server so the next step (adding shape templates like `palm_tree` to `ai-planning`) ships server-side only. That template work is a follow-up, not part of this plan.
