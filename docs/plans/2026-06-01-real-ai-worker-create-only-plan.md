# Real AI Worker Slice: Provider-Agnostic, Gemini First, Create Only

## Summary

Build a new runnable `@3dvibegame/ai-worker` package so prompt-to-create can hit a real LLM-backed service instead of fixtures. Keep the worker external to SpacetimeDB. The browser will call it through the existing `VITE_AI_WORKER_URL` path, and the backend will continue to validate submitted specs through reducers.

Use the Vercel AI SDK with `@ai-sdk/google` and Gemini first. The AI SDK docs confirm Google provider support via `@ai-sdk/google`, `GOOGLE_GENERATIVE_AI_API_KEY`, and Gemini model IDs, and structured generation through `Output.object()`/Zod-style schemas.

Sources: [AI SDK Gemini guide](https://ai-sdk.dev/cookbook/guides/gemini), [AI SDK structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [Google provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai).

## Status

Implemented in Phase 3.8 through Phase 3.10. The current worker defaults to `gemini-2.5-flash` unless `AI_WORKER_MODEL` is set. On 2026-06-01, `pnpm --filter @3dvibegame/ai-worker smoke:gemini-live` passed with a local repo-root `.env` key, proving one real create-only LLM call through the worker.

## Key Changes

- Add `packages/ai-worker/` as a Node TypeScript HTTP service.
- Add dependencies: `ai`, `@ai-sdk/google`, `zod`, `dotenv`, `tsx`, and workspace dependency `@3dvibegame/scene-authority-ts`.
- Expose:
  - `POST /generate` for create requests.
  - `GET /healthz` for local smoke checks.
  - `OPTIONS /generate` for browser CORS preflight.
- Config:
  - `AI_WORKER_PORT=8787`
  - `AI_WORKER_HOST=127.0.0.1`
  - `AI_WORKER_MODEL=gemini-3-pro-preview`
  - `GOOGLE_GENERATIVE_AI_API_KEY=<key>`
  - `AI_WORKER_TIMEOUT_MS=20000`
  - `AI_WORKER_ALLOWED_ORIGIN=http://127.0.0.1:5173`

## Worker Behavior

- Accept the existing frontend HTTP request shape:
  - `operation: "create"`
  - `source_prompt`
  - `target_object_id: null`
  - `base_object_version: null`
  - `object_context: null`
- Reject `refine` and `remix` for this slice with `status: "failed"` and `error_code: "unsupported_request"`.
- Use Gemini through the AI SDK to generate a constrained create plan, not arbitrary geometry.
- Deterministically convert that plan into a canonical `VoxelBuilderSpec`.
- Compile `VoxelBuilderSpec` with `compileVoxelBuilderSpec()` into the renderer `BuilderSpec`.
- Return the existing frontend-compatible response:
  - `status: "completed"`
  - `job_id_base`
  - `object_id_base`
  - `source_spec`
  - `builder_spec`
  - `warnings`

## Frontend Wiring

- Keep `AiWorkerClient` public shape unchanged.
- Change `createConfiguredAiWorkerClient()` so:
  - `createDraft()` uses the HTTP worker when `VITE_AI_WORKER_URL` is set.
  - `createEdit()` remains fixture-backed for now, because the first slice is create-only.
- Add root scripts:
  - `pnpm ai-worker:dev`
  - `pnpm --filter @3dvibegame/ai-worker typecheck`
- Document live startup:
  - Start SpacetimeDB backend.
  - Start AI worker with Gemini key.
  - Start demo with `VITE_AI_WORKER_URL=http://127.0.0.1:8787/generate` plus SpacetimeDB env vars when using live backend.

## Test Plan

- Unit test request validation, unsupported operations, CORS, and health check.
- Unit test deterministic conversion from model create plan to valid `VoxelBuilderSpec`.
- Unit test that compiled `builder_spec` matches backend/front-end contract expectations.
- Add an HTTP smoke using a fake model adapter so CI does not require a Gemini key.
- Add optional live smoke gated by `GOOGLE_GENERATIVE_AI_API_KEY` that sends one prompt and validates a completed `source_spec`/`builder_spec`.
- Run:
  - `pnpm --filter @3dvibegame/ai-worker typecheck`
  - `pnpm --filter @3dvibegame/ai-worker test`
  - `pnpm --filter @3dvibegame/scene-runtime-demo typecheck`
  - existing backend first-playable smoke

## Assumptions

- First real LLM slice is **create only**.
- Gemini is the first concrete provider, but the worker is structured around a provider adapter so later providers can be added without changing the HTTP contract.
- The LLM does not write to SpacetimeDB and does not emit authoritative backend mutations.
- The worker emits world-native object specs only; no raw mesh payloads, terrain edits, scripting, accounts, or economy.
