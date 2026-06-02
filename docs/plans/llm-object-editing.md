# Plan: Edit a selected object via chat (AI recolor / refine)

## Context

The vision is "describe a change, get a rough draft, lightly refine, release it," and the backend already supports edits (`request_edit_lock` → `submit_object_edit` → version bump → cooldown). But the **deployed player app can't AI-edit a selected object**: both browser-Gemini clients throw `unsupported_request` for `createEdit` ("create only"), `ai-planning` has no edit prompt, and there's no UI to aim a chat prompt at the selected object. Direct manipulation (move/rotate/scale/delete, Phase 4.9) is deterministic, not AI.

**Goal:** in a live room, click an object, type a change ("make it red", "add a glowing top") in the prompt box, and the LLM produces an edited version that the backend submits as a new version. Reuses everything we built for create: the Gemini→voxel-core→`/compile` pipeline, edit locks, and the authority `submit_object_edit` flow.

**Scope:** the **live/backend path** (what the deploy runs). Local-only (no-backend) edit is a noted follow-up because the local session doesn't retain the source spec.

---

## Approach

The edit is the create pipeline with two differences: the **LLM gets the current spec + a change request** (instead of just a prompt), and the backend submits via **`submit_object_edit`** (instead of `submit_ai_draft`). The worker `/compile` endpoint is reused **unchanged** — it just compiles a voxel core into a builder spec.

### 1. `@3dvibegame/ai-planning` — edit system prompt

**File:** `packages/ai-planning/src/contracts.ts`
- Add `voxelEditSystemPrompt`: like `voxelBuilderSystemPrompt`, but instructs the LLM that it's given the object's **current** voxel core (materials + operations) and a **change request**, and must return the **full edited voxel core** in the same shape (`voxelCoreSchema`). Emphasize: keep what isn't changed; for recolors, swap `material_id` to a renderer-known id (`red`, `moss_stone`, …); for "add X", append ops; keep it grounded and within the op count.

No new schema or endpoint — the edited output is a `VoxelCore`, validated by the existing `voxelCoreSchema`, compiled by the existing `/compile` → `buildVoxelResponse`.

### 2. `3dvibegame-web` — Gemini edit call + implement `createEdit`

**File:** `packages/3dvibegame-web/src/core/aiWorker/geminiVoxel.ts`
- Add `generateVoxelEdit({ apiKey, fetchImpl, model, currentCore, changePrompt, temperature, timeoutMs })`: mirrors `generateVoxelCore` but uses `voxelEditSystemPrompt` and a user message containing the current core JSON + the change request. Returns a validated `VoxelCore`. (Factor the shared fetch/parse out of `generateVoxelCore` so both share it.)

**Files:** `browserGeminiHttpCompileClient.ts`, `browserGeminiAiWorkerClient.ts`
- Replace the `createEdit` stubs with a real implementation:
  1. Parse `objectContext.sourceSpecJson` → current `VoxelBuilderSpec`; reduce it to a `VoxelCore` (object_category, size_tier, style_tags, behaviors, materials, operations).
  2. `generateVoxelEdit({ currentCore, changePrompt: input.sourcePrompt })` → edited core.
  3. Compile: http-compile client POSTs `{ operation:"create", source_prompt, voxel: editedCore }` to `/compile`; local client calls `buildVoxelResponse` in-process. Return the `AiWorkerArtifact` (same `toArtifact`/`workerResponseToArtifact` helpers as create).

**File:** `fixtureAiWorkerClient.ts`
- Loosen the `AiWorkerClient.createEdit` interface: make `actionId?` optional (free-form edits have no scenario action; the `sourcePrompt` is the instruction). Fixture `createEdit` keeps requiring `actionId` for its canned recipes and throws otherwise (it's only the no-key fallback).

### 3. `3dvibegame-web` — backend edit command

**File:** `packages/3dvibegame-web/src/backend/createBackendLifecycleCommands.ts`
- Add `editSelectedObject(prompt: string)` to the interface + impl, modeled on the existing scenario-refine branch in `dispatchAction` (`createBackendLifecycleCommands.ts:251-279`):
  1. Resolve the selected object (`selectBackendObject(snapshot, selectedObjectId())`); reject if missing or locked/grace by another player.
  2. `aiWorker.createEdit({ baseObjectId, baseVersion: object.version, sourcePrompt: prompt, objectContext: { objectId, version, sourceSpecJson: sourceSpecJsonForObject(snapshot, id), builderSpecJson: JSON.stringify(object.builder_spec) } })`.
  3. If `object.state === "public"` → `requestEditLock`; if it's already `edit_locked` by us (from selection), skip. Then `submitObjectEdit({ objectId, baseVersion, sourceSpecJson, builderSpecJson })` → `expireCooldown` → public `v+1`. Reuse `userFacingAiWorkerError`.

### 4. `3dvibegame-web` — route the prompt to edit when an object is selected

**File:** `packages/3dvibegame-web/src/App.tsx`
- In `handlePromptSubmit`: if `backendCommandsRef.current?.canHandle()` **and** `selectedObjectIdRef.current` (a manually-clicked object, which is edit-locked by us), call `editSelectedObject(prompt)` and surface errors via `contextMsg`; otherwise keep the create path.
- Pass an `editing` flag (live + `selectedObjectId !== null`) down so the **prompt placeholder** switches to *"Describe a change to the selected object…"*.

**File:** `packages/3dvibegame-web/src/components/PromptInput.tsx`
- Accept an optional `placeholder`/`editing` prop and show the edit hint + an "Edit" button label when editing.

**File:** `packages/3dvibegame-web/src/components/GenerationCard.tsx`
- Add a one-line hint when an object is selected: *"Type a change below to edit with AI."*

### Reuse / safety
- Edit exclusivity already works: selecting locks the object (the 30s lock), so others can't edit it mid-change; `submit_object_edit` re-checks `lockOwner` + `baseVersion` server-side and rejects stale edits.
- The renderer re-renders on the version bump (SceneObjects keys include version). No renderer changes.
- `parseVoxelBuilderSpec` validates the edited spec; bad edits surface as `validation_failed`.

---

## Files touched

| File | Change |
|---|---|
| `packages/ai-planning/src/contracts.ts` | add `voxelEditSystemPrompt` |
| `packages/3dvibegame-web/src/core/aiWorker/geminiVoxel.ts` | add `generateVoxelEdit` (+ extract shared fetch) |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiHttpCompileClient.ts` | implement `createEdit` (edit → `/compile`) |
| `packages/3dvibegame-web/src/core/aiWorker/browserGeminiAiWorkerClient.ts` | implement `createEdit` (edit → local compile) |
| `packages/3dvibegame-web/src/core/aiWorker/fixtureAiWorkerClient.ts` | make `createEdit` `actionId?` optional |
| `packages/3dvibegame-web/src/backend/createBackendLifecycleCommands.ts` | add `editSelectedObject(prompt)` |
| `packages/3dvibegame-web/src/App.tsx` | route prompt → edit when an object is selected |
| `packages/3dvibegame-web/src/components/PromptInput.tsx` | edit placeholder/label |
| `packages/3dvibegame-web/src/components/GenerationCard.tsx` | "type a change to edit" hint |

---

## Verification

1. **Typecheck:** `pnpm --filter @3dvibegame/ai-planning typecheck`, `… @3dvibegame/3dvibegame-web typecheck`.
2. **Unit/UI tests:** `pnpm web:test` stays green; add a `PromptInput` test for the edit placeholder and a `GenerationCard` hint test.
3. **Worker unchanged:** `/compile` already covered by `pnpm --filter @3dvibegame/ai-worker test` (edits reuse it).
4. **End-to-end (live room, needs Gemini key + backend):** create an object, release it, **click it** (locks it), type "make it red" → a new version appears recolored; type "add a glowing sphere on top" → version bumps again with the added geometry. Confirm in the Network tab: one Gemini call + one `/compile` call per edit. A second browser confirms it can't edit the object while you hold it.
5. **Stale-edit guard:** two players selecting the same object — the second is rejected ("locked by another player").

> Follow-ups (out of scope): local-only (no-backend) edit needs the session to retain each object's source spec; a chat transcript / multi-turn refine history; and surfacing edit attribution.
