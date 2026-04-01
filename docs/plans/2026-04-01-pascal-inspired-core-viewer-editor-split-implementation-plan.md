# Pascal-Inspired Core Viewer Editor Split Implementation Plan

Date: 2026-04-01
Depends on: `docs/plans/2026-04-01-pascal-inspired-core-viewer-editor-split-design.md`

## Goal

Refactor `packages/scene-runtime-demo` into an internal `core` / `viewer` / `editor` architecture without changing the product scope.

The refactor must preserve the current working loop:

`submit prompt -> staged generation -> grace edits -> release`

## Strategy

Do this as a staged migration, not a big-bang rewrite.

Each phase should leave the demo working, typechecked, and buildable.

## Current Starting Point

The current demo code is concentrated in:

- `src/runtime/`
- `src/render/`
- `src/ui/`
- `src/main.ts`

The main structural problems are:

- state is spread across controller objects rather than a normalized scene document
- render updates still rebuild more than they should
- HUD actions call controller methods directly
- there is no object registry, typed event bus, or history batching layer yet
- local interaction state is not yet shaped around `player_id`

## Phase 1: Introduce Internal Module Boundaries

Create the target folder split inside `packages/scene-runtime-demo/src`:

```txt
src/
  core/
  viewer/
  editor/
```

### Work

- create placeholder module barrels for `core`, `viewer`, and `editor`
- move code by responsibility without changing behavior yet
- keep `main.ts` as the assembly layer only

### Initial file mapping

- `src/render/app/*` -> `src/viewer/app/*`
- `src/render/objects/*` -> `src/viewer/objects/*`
- `src/render/adapters/authorityBridge.ts` -> `src/viewer/systems/objectSync.ts`
- `src/ui/createHud.ts` -> `src/editor/ui/createHud.ts`
- `src/runtime/scenarios.ts` -> `src/core/fixtures/scenarios.ts`
- `src/runtime/generationSession.ts` -> split across `src/core` and `src/editor`

### Acceptance criteria

- imports reflect `core` / `viewer` / `editor` boundaries
- `main.ts` becomes a thin composition root
- demo behavior remains unchanged

## Phase 2: Introduce Normalized Scene State

Add a normalized `SceneDocument` and stop treating the controller object as the main source of truth.

### New `core` responsibilities

- `SceneDocument`
- `SceneObjectRecord`
- `PlayerSessionState`
- `GenerationSessionState`
- `ToolState`
- `SharedDirtyState`
- selectors for current object, focus target, and stage summaries

### Work

- create `src/core/state/contracts.ts`
- create `src/core/state/createSceneDocument.ts`
- convert current generation controller state into normalized document state
- store released and draft objects in `objects_by_id`
- keep `root_object_ids` explicit even if there is only one object now
- add `player_sessions_by_id`
- run the first pass through a default local session such as `player_1`
- move camera, selection, tool state, and history under the player session

### Acceptance criteria

- viewer reads from normalized records, not from ad hoc controller state
- generation session state lives under the scene document
- object transforms and compiled artifacts live on explicit object records
- local camera, selection, tool state, and history are resolved through a `player_id`-scoped session

## Phase 3: Add Dirty Tracking And Incremental Compilation

Introduce explicit dirty flags and make compilation incremental.

### Work

- add shared dirty flags for `source_dirty_ids`, `artifact_dirty_ids`, and `render_dirty_ids`
- keep `selection_dirty` and `camera_dirty` on the player session, not global state
- add a `compileDirtyObjects` core system
- compile only the objects whose voxel source or transform changed
- cache derived metadata such as bounds, diagnostics, and focus point on the object record

### Expected behavior

- prompt submission marks the incoming object dirty through the staged flow
- move, rotate, and scale actions mark only the affected object dirty
- release clears transient draft state without forcing a full scene reset

### Acceptance criteria

- per-object compile work is explicit
- dirty flags clear after successful recompute
- no full world rebuild is required for a single-object update
- one player session’s camera dirtiness cannot affect another player’s session state

## Phase 4: Add Viewer Registry And Object Sync System

Replace the current clear-and-rebuild render path with a registry-driven sync model.

### New `viewer` responsibilities

- `objectRegistry`
- object mount and unmount helpers
- dirty-object render sync
- focus and bounds helpers

### Work

- add `src/viewer/registry/objectRegistry.ts`
- add `src/viewer/systems/syncSceneObjects.ts`
- make registry track:
  - `object_id -> THREE.Group`
  - `object_id -> focus point`
  - optional `render_class -> Set<object_id>`
- update only dirty objects in place
- remove whole-scene clearing from the normal sync path

### Acceptance criteria

- viewer can refresh one object by id
- focus can resolve by object id or cached focus point
- scene traversal is no longer the main update mechanism

## Phase 5: Add Typed Events And Editor Commands

Introduce a typed event bus and separate UI from scene mutation logic.

### New `editor` responsibilities

- command functions for prompt submission and tool actions
- HUD-facing selectors
- command dispatch through typed events where appropriate

### Work

- add `src/core/events/bus.ts`
- define initial typed events:
  - `generation:prompt-submitted`
  - `generation:stage-changed`
  - `object:selected`
  - `viewer:focus-object`
  - `tool:action-requested`
  - `history:batch-started`
  - `history:batch-committed`
- make session-local event payloads carry `player_id`
- move direct HUD action handling into editor commands
- keep the bus local to the demo architecture, not the network layer

### Acceptance criteria

- HUD no longer calls viewer or renderer code directly
- tool actions route through commands and typed events
- viewer listens for focus or selection intent without owning editor state
- session-local viewer/editor events are bound to a `player_id`

## Phase 6: Add Command History With Batch Semantics

Introduce the minimal undo model needed for the next pointer-driven slice.

### Work

- add `src/core/history/`
- represent committed actions as history entries
- add `beginBatch`, `commitBatch`, and `cancelBatch`
- treat each current button action as one committed batch
- keep transient updates out of history
- scope history stacks and active batches per player session

### Why now

The immediate UI still uses buttons, but this phase validates the exact contract needed for:

- move gesture starts batch
- drag updates stay transient
- gesture end commits one undo entry

### Acceptance criteria

- history can group work into a single commit
- current tool actions produce one history entry each
- the architecture is ready for drag-based manipulation next
- undo state is isolated per `player_id`

## Phase 7: Cleanup And Remove Transitional Paths

Once the new paths are stable, remove obsolete demo-only controllers and duplicate state.

### Work

- remove or retire `src/runtime/lifecycle.ts` if it is no longer part of the active flow
- remove transitional adapter code that only existed to bridge old and new state
- simplify imports and tighten module boundaries

### Acceptance criteria

- one obvious way exists to mutate state
- one obvious way exists to project objects into the scene
- unused controller patterns are gone

## Validation Checklist

After each phase:

- run `pnpm typecheck`
- run `pnpm demo:build`
- smoke test the prompt flow in the demo

The final refactor succeeds if:

- the prompt-to-release prototype still works
- scene truth lives in normalized records
- viewer updates are registry-driven and incremental
- tool actions are command-driven
- history batching exists for the next drag slice
- local interaction state is scoped by `player_id` even though the demo still runs as `player_1`

## Deliberate Deferrals

Do not add these in this refactor:

- direct pointer drag manipulation
- hover interaction adapters
- gizmos
- real multiplayer networking or cross-client synchronization
- workspace package promotion

Those belong to the next slice, after this architecture is stable.

## Recommended Execution Order

1. Create `core` / `viewer` / `editor` folders and move files with minimal logic changes.
2. Introduce `SceneDocument` and migrate state ownership.
3. Add dirty-object compile flow.
4. Add object registry and incremental viewer sync.
5. Introduce typed events and command-based editor actions.
6. Add history batching.
7. Remove transitional code.

This order keeps behavior working while steadily increasing architectural rigor.
