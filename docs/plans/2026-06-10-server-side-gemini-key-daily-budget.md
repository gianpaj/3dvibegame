# Server-side Gemini key + daily budget (keyless client)

**Date:** 2026-06-10 (revised after code review; decisions resolved)
**Status:** Accepted

## Goal

Move the Gemini API key off the client and onto the `ai-worker` server so players
don't need to supply their own key. Enforce a **daily budget**; once exceeded,
the worker returns an error message the client surfaces gracefully.

## Current state

- **Client (`packages/3dvibegame-web`)** defaults to `browser-gemini` mode: the
  browser calls Gemini **directly** with a **user-supplied key** (entered via
  `GeminiKeyModal`, held in `geminiKeyRef`), runs the rich voxel-authoring path
  (`src/core/aiWorker/geminiVoxel.ts` → `generateVoxelCore` / `generateVoxelEdit`),
  then POSTs the voxel core to the worker's keyless `/compile` endpoint
  (`browserGeminiHttpCompileClient.ts`).
- **The prompts and schemas are already shared.** `voxelBuilderSystemPrompt`,
  `voxelEditSystemPrompt`, `avatarSystemPrompt`, `voxelCoreSchema`, and
  `compileVoxelRequestSchema` all live in `@3dvibegame/ai-planning`
  (`src/contracts.ts`). `ai-worker/src/contracts.ts` is just
  `export * from "@3dvibegame/ai-planning"`. What is **client-only** is the
  ~240-line Gemini REST caller in `geminiVoxel.ts` (fetch + JSON-mode config +
  zod validation + `coreFromSourceSpec`).
- **Server (`packages/ai-worker`)** is a Node HTTP server (Docker/Coolify, port
  8787) with:
  - `POST /compile` — keyless, voxel core → builder spec via
    `buildVoxelResponse`, **no LLM**.
  - `POST /generate` — uses a **server-side** key
    (`GOOGLE_GENERATIVE_AI_API_KEY` via `@ai-sdk/google`), **but** only does
    coarse category-planning (`createGeminiPlanGenerator`) → procedural
    geometry, and only supports `create`. This is **not** the quality path the
    browser uses today.
- **Avatars ride the same path.** `AiWorkerClient.createDraft/createEdit` take
  `purpose?: "object" | "avatar"`; avatar mode selects `avatarSystemPrompt` and
  the client reads `voxel.scale` → `avatarScale` and `voxel.quantity` off the
  Gemini result. The current `httpAiWorkerClient` sends **neither** `purpose`
  nor receives scale/quantity — going keyless without fixing this would break
  the avatar editor and multi-object creates.

So the server already has a Gemini key wired — but not the high-quality
voxel-authoring path, and with no budget guard or abuse protection. The real
work is: move the browser's Gemini caller server-side, gate it with a budget,
and make the client keyless — **without losing the avatar/scale/quantity
round-trip**.

## Plan

### 1. Shared: make the Gemini caller portable

Move the Gemini REST caller out of `3dvibegame-web/src/core/aiWorker/geminiVoxel.ts`
into `@3dvibegame/ai-planning` (it already owns the prompts, `voxelCoreSchema`,
and depends on `scene-authority-ts`, which `coreFromSourceSpec` needs). Porting
notes:

- Replace `window.setTimeout` / `window.clearTimeout` with plain
  `setTimeout`/`clearTimeout` (works in both browser and Node).
- It throws the web app's local `AiWorkerError` class
  (`aiWorkerErrors.ts`). Move a shared `AiWorkerError` (code + message) into
  `ai-planning` next to `AiWorkerFailureCode`; the web's `aiWorkerErrors.ts`
  re-exports or wraps it.
- Return token usage alongside the voxel core: the raw REST response carries
  `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`,
  `thoughtsTokenCount`) — **not** the AI-SDK `generateText().usage` (that only
  exists on the legacy `/generate` plan path). Thinking is enabled
  (`thinkingBudget: -1`), and thought tokens bill at the output rate, so the
  cost estimate must include `thoughtsTokenCount`.
- The web keeps importing the same functions (for the optional BYOK dev
  fallback), so behavior stays identical on both sides.

### 2. Server: keyless authoring endpoint (core change)

Add `POST /author` to `server.ts`, handling both `create` and `refine`:

1. Run rate-limit + budget check (below) **before** the Gemini call.
2. `create`: `generateVoxelCore({ prompt, purpose, ... })` with the env key.
   `refine`: derive the current core via
   `coreFromSourceSpec(object_context.sourceSpecJson)` (the client already
   sends `object_context` with `sourceSpecJson`; today its schema is
   `z.unknown()` — type it), then `generateVoxelEdit`.
3. Compile via the existing `buildVoxelResponse` (same code `/compile` uses).
4. Record spend from `usageMetadata`, return the artifact.

Contract changes (in `ai-planning/src/contracts.ts`):

- **Request**: `aiWorkerRequestSchema` + `purpose: z.enum(["object","avatar"]).optional()`
  (or a dedicated `authorRequestSchema`).
- **Response**: `AiWorkerCompletedResponse` today only has job ids, specs, and
  warnings. Add `quantity` and `scale` (echoed from the validated
  `VoxelCore`) so the client no longer needs local access to the raw Gemini
  result for `avatarScale`/multi-object creates.

Server plumbing details (easy to miss):

- Add `/author` to the CORS `OPTIONS` preflight branch (currently hardcoded to
  `/generate` and `/compile`).
- `server.ts` has its own `isFailureCode` allowlist and the handler default
  `timeoutMs` is **20s**, but the browser Gemini path uses **45s**
  (`defaultGeminiTimeoutMs`) because 2.5-flash with thinking is slow. Use
  ~45–60s for `/author`.
- Keep `/compile` for the BYOK fallback; deprecate `/generate` later.

### 3. Daily budget enforcement

Add a small budget module in `ai-worker` (e.g. `src/budget.ts`):

- **Unit (decided):** estimated USD from token usage. Compute per-call cost
  from `usageMetadata`: `promptTokenCount` × input price +
  (`candidatesTokenCount` + `thoughtsTokenCount`) × output price, using
  `gemini-2.5-flash` price constants.
- **State:** in-memory `{ utcDay, spentUsd }`. On each request, if the UTC day
  rolled over, reset to 0. **Check before the call:**
  `if (spentUsd >= AI_WORKER_DAILY_BUDGET_USD) → reject`. Accumulate
  `spentUsd += cost` after each successful call.
- **Persistence caveat:** in-memory resets on redeploy and isn't shared across
  replicas. Fine for a single Coolify container (MVP) — ship that, note the
  limitation. For >1 replica, swap the counter for Redis/KV/SpacetimeDB behind
  the same interface.
- **Error contract:** add `budget_exhausted` (and `rate_limited`) to
  `aiWorkerFailureCodes` in **`ai-planning/src/contracts.ts`** (the source of
  truth — `ai-worker/src/contracts.ts` is a re-export). The web app duplicates
  the code list in `src/core/aiWorker/aiWorkerErrors.ts`
  (`supportedFailureCodes` + `aiWorkerFailureLabel`) and `server.ts` has its
  own `isFailureCode` — update all three, otherwise
  `aiWorkerFailureCodeFromUnknown` silently coerces the new code to
  `generation_failed` and the UI can't show a distinct message. Return HTTP
  **429** with a friendly message ("Daily AI budget reached — try again
  tomorrow.").

> **On relying on Gemini's own error:** Gemini's API only errors when *Google's*
> quota is hit (429 `RESOURCE_EXHAUSTED`). Relying on that alone is imprecise
> (Google budgets *alert*, they don't hard-stop spend; only per-request **quota**
> caps do). Recommended: **our own budget guard is the primary control**, and
> additionally **set a requests/day quota cap on the key in Google Cloud Console**
> as a backstop. The server should also catch Gemini's 429 and surface it as the
> same `budget_exhausted` / `rate_limited` error.

### 4. Abuse protection (important)

**Decided: private beta level** — per-IP rate limit + CORS origin lock, no
captcha for now.

- **Per-IP rate limit** (e.g. N requests/min, in-memory token bucket keyed by
  `x-forwarded-for` — the worker sits behind Coolify's proxy, so trust the
  first XFF hop only).
- **Lock CORS** to the site origin via the existing `AI_WORKER_ALLOWED_ORIGIN`
  (note: CORS is friction, not real security).
- Revisit before going fully public: **Cloudflare Turnstile / hCaptcha** or a
  signed app token.

### 5. Client changes (`packages/3dvibegame-web`)

- **Default mode → `http-worker`** (keyless). Set `VITE_AI_CLIENT_MODE=http-worker`
  + `VITE_AI_WORKER_URL`.
- **Update `httpAiWorkerClient`**: point at `/author`; pass `purpose` through
  on both `createDraft` and `createEdit`; read `quantity` and
  `scale` → `avatarScale` from the response (today it hardcodes
  `quantity: 1` and never sets `avatarScale`); raise its default 20s timeout to
  match the authoring latency (~45–60s, reuse `VITE_AI_WORKER_TIMEOUT_MS`).
- **Keep BYOK, off by default (decided).** `browser-gemini` mode stays as a
  dev/fallback path, gated by the existing env var: it activates only when
  `VITE_AI_CLIENT_MODE=browser-gemini` is explicitly set (no new flag needed).
  In the default `http-worker` mode, `GeminiKeyModal` and the
  `getBrowserGeminiApiKey` wiring in `App.tsx` (imports, `geminiKeyRef`, the
  two `createConfiguredAiWorkerClient` call sites, the modal render) must not
  be reachable — render the modal and key-settings entry point only when the
  resolved mode is `browser-gemini`.
- **Budget-exhausted UX:** on `budget_exhausted`, show a clear toast/banner
  ("Daily limit reached") instead of a generic failure (label comes from
  `aiWorkerFailureLabel`).

### 6. Config / env summary

| Where | Var | Purpose |
|---|---|---|
| ai-worker | `GOOGLE_GENERATIVE_AI_API_KEY` | server key (already exists) |
| ai-worker | `AI_WORKER_DAILY_BUDGET_USD` | daily cap |
| ai-worker | `AI_WORKER_ALLOWED_ORIGIN` | CORS lock (exists) |
| ai-worker | `AI_WORKER_RATE_LIMIT_PER_MIN` | per-IP throttle |
| web | `VITE_AI_CLIENT_MODE=http-worker` | keyless mode |
| web | `VITE_AI_WORKER_URL` | worker URL |
| web | `VITE_AI_WORKER_TIMEOUT_MS` | raise for authoring (~60000) |

## Rollout

1. Port the Gemini caller (+ shared `AiWorkerError`, usage reporting) into
   `ai-planning`; web imports move, behavior unchanged. Ship.
2. Add `/author` with budget + rate limit + new failure codes (server only,
   testable via curl — including an avatar `purpose` round-trip).
3. Flip web app default to `http-worker`, update `httpAiWorkerClient`
   (purpose/scale/quantity/timeout), gate the key modal behind
   `browser-gemini` mode, add budget UX.
4. Set Google Cloud quota cap as backstop; deploy.

## Decisions (resolved 2026-06-10)

1. **Budget unit:** USD estimated from `usageMetadata` tokens.
2. **Abuse protection:** private beta — per-IP rate limit + CORS origin lock;
   captcha/signed token deferred until fully public.
3. **BYOK:** kept, but off by default — only active when
   `VITE_AI_CLIENT_MODE=browser-gemini` is explicitly set.
