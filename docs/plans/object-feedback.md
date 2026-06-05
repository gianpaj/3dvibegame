# Plan: user feedback on generated / edited objects

Let players rate an AI result (👍 / 👎) right after it's created or edited, and persist
enough context that we can later analyse *why* a result was good/bad and improve the
system — the LLM choice, the system prompts, the assembler, etc.

Builds on the AI create/edit pipelines (`createBackendLifecycleCommands.ts`) and the
backend world module (`packages/world-backend`).

## Decisions (resolved)

- **Rating:** thumbs **up / down** only (binary is the cleanest signal to aggregate).
- **Scope of v1:** **rating only** — no free-text comment yet. (Comment + profanity check
  is a clean follow-up; the table leaves room for it.)
- **Surface:** a **new dedicated card** in the HUD (a `FeedbackCard`), not folded into the
  `GenerationCard` or the chat transcript.
- **Submit once:** the card is **hidden as soon as a rating is submitted**, and a player
  **cannot resubmit** for the same operation. The unit of "one operation" is an
  `operation_id` (see below) — the create job, or a single edit. No flipping 👍↔👎.
- **Persistence:** a new SpacetimeDB table `object_feedback` in `world-backend`.

## Can we reconstruct/analyse a piece of feedback? — yes (we snapshot)

Each feedback row is **self-contained**: we copy the three things needed to understand it
*at submit time* rather than pointing at live tables that change underneath us.

| captured | what it is | why snapshot (not reference) |
|---|---|---|
| `source_prompt` | the player's exact words | the input we're judging |
| `source_spec_json` | the LLM-authored voxel core / "source" JSON | — |
| `builder_spec_json` | the compiled **3D object** spec JSON | — |
| `model_id` | e.g. `gemini-2.0-flash` | correlate quality ↔ model |
| `prompt_version` | version of the create/edit system prompt | correlate quality ↔ prompt change |

**Why copy the JSONs instead of joining to `object_artifact`:** `object_artifact` stores
only the **latest** version's spec for an object. If a player rates v2 and someone later
edits it to v3 (or deletes it), the artifact no longer holds the JSON that was actually
rated — the feedback would become unanalysable. Snapshotting makes each row immune to
later edits/deletes. The client already has both JSON strings in hand at create/edit time
(`AiWorkerDraftResult` / edit result expose `sourceSpecJson` + `builderSpecJson`), so no
extra lookup is needed — they're just forwarded to the reducer.

> Storage note: `builder_spec_json` is a few KB per row. Fine at MVP volume. If it ever
> grows, we can move to a content-addressed `spec_blob` table keyed by hash and store the
> hash here — but not in v1.

## Table: `object_feedback` (`packages/world-backend/src/schema.ts`)
Not `public` — submit-only; analysed via `spacetime sql` export, not broadcast to clients.

| column | type | notes |
|---|---|---|
| `feedback_id` | `u64` PK autoInc | |
| `world_id` | `u64` | |
| `object_id` | `string` | |
| `object_version` | `u32` | the version that was rated |
| `operation_id` | `string` | **dedupe key** — see below |
| `operation` | `string` | `"create"` \| `"edit"` |
| `rating` | `string` | `"up"` \| `"down"` |
| `source_prompt` | `string` | snapshot |
| `source_spec_json` | `string` | snapshot |
| `builder_spec_json` | `string` | snapshot |
| `model_id` | `string` | snapshot |
| `prompt_version` | `string` | snapshot |
| `player_identity` | `identity` | who |
| `player_nickname` | `string` | who (denormalised for export) |
| `created_at` | `timestamp` | when |

Index: btree on `operation_id`.

**`operation_id` — the unit of "one operation":**
- **create:** the generating AI job's `job_id` (e.g. `backend_create_…`), which the client
  already mints in `submitPrompt`.
- **edit:** edits don't create an `ai_job`, so the client mints an edit-op id in
  `editSelectedObject` (e.g. `backend_edit_<ts>_<seq>`) and threads it through the result so
  the card can reference it. (It's also a useful provenance handle in the row.)

**Submit once (no resubmit):** one rating per `operation_id`. The reducer **rejects** a
second submission for an `operation_id` that already has a row (`SenderError` "feedback
already submitted") — it does **not** upsert/overwrite. Because each `operation_id` belongs
to exactly one create/edit by one player, this is effectively one-rating-per-operation. The
client also tracks submitted `operation_id`s locally and hides the card immediately, so the
reject path is just a safety net (e.g. double-click / reconnect).

## Backend reducer (`packages/world-backend/src/index.ts`)

`submit_object_feedback({ operationId, objectId, objectVersion, operation, rating, sourcePrompt, sourceSpecJson, builderSpecJson, modelId, promptVersion })`:
- `requireActivePlayer` (must be joined to a world).
- Validate: `operation ∈ {create, edit}`, `rating ∈ {up, down}`, non-empty `operationId`;
  cap each JSON/prompt string length (e.g. prompt ≤ 1_000, each JSON ≤ 16_000) →
  `SenderError` on violation.
- **Reject duplicates:** scan `object_feedback` for an existing row with this `operationId`;
  if found → `SenderError` "feedback already submitted for this operation". (No composite
  unique index in the SQL subset, so this is a reducer-side scan.)
- Resolve the player's `world_id` + nickname from `player_session`; insert (`feedback_id: 0n`).
- *(v1 has no comment, so no profanity check yet — added with the comment field later.)*

## Prompt versioning (`packages/ai-planning`)

Add `export const PROMPT_VERSION = "v1";` (bump on any edit to `voxelBuilderSystemPrompt` /
`voxelEditSystemPrompt`). Export so the web client can stamp it onto feedback. This is what
makes "did prompt v2 lift the 👍 rate?" a one-line query.

## Client (`packages/3dvibegame-web`)

- Regenerate `module_bindings` (`object_feedback` table + `submit_object_feedback`).
- **Thread provenance + operation id through the AI result:** include `modelId` on
  `AiWorkerDraftResult` / edit result (the configured Gemini model string), and import
  `PROMPT_VERSION` from `ai-planning`. The lifecycle command keeps the **last operation's**
  `{ operationId, objectId, version, operation, sourcePrompt, sourceSpecJson, builderSpecJson, modelId }`
  so the card can submit without re-deriving anything. For creates `operationId` is the
  `job_id`; for edits, `editSelectedObject` mints `backend_edit_<ts>_<seq>` and stores it.
- Bridge: `submitObjectFeedback(input)` → `reducers.submitObjectFeedback({...})`.
- **`FeedbackCard`** (new): appears when the local player has just created (draft in grace)
  or edited an object — i.e. there's a pending un-rated operation. Two buttons (👍 / 👎); on
  click, fire-and-forget submit, then **hide the card immediately** (don't wait for the
  round-trip). Track submitted `operationId`s in a local `Set` so the card never reappears
  for an operation already rated, and so a player **can't resubmit** for the same
  create/edit. Hidden in viewer mode and when offline.
- App: render `FeedbackCard` in the HUD (its own slot); wire `onRate`.

## Analysing the data

Export for offline analysis (no aggregates/ORDER BY in the SQL subset, so pull rows and
crunch locally):

```sh
spacetime sql --server <url> 3dvibegame \
  "SELECT rating, operation, model_id, prompt_version, source_prompt FROM object_feedback"
```

Then bucket 👍/👎 by `model_id` × `prompt_version` × `operation`, and pull `source_prompt` +
`source_spec_json` + `builder_spec_json` for the 👎 rows to inspect failure patterns and feed
prompt revisions.

## Tests

- `world-backend/scripts/smoke-feedback.mjs`: submit up/down; validation (bad `rating`,
  bad `operation`, empty `operationId`, over-long JSON); **resubmit rejected** (second
  submit for the same `operationId` → `SenderError`, still one row); non-joined caller
  rejected.
- `3dvibegame-web`: `FeedbackCard.test.tsx` (renders for an unrated operation; 👍/👎 call
  `onRate` with the right payload; **hidden once submitted** and stays hidden for that
  `operationId`; hidden in viewer mode); bridge call-shape test.

## Out of scope (v1)

Free-text comment + profanity check, editing/withdrawing a rating from the UI, per-object
aggregate display ("87% liked this"), moderation of feedback, rate-limiting, and an
in-app analytics dashboard (export + offline analysis only for now).
