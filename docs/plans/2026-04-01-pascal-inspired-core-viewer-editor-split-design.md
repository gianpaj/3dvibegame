# Pascal-Inspired Core Viewer Editor Split Design

Date: 2026-04-01

## Goal

Refactor the current prototype toward the strongest Pascal learnings without overbuilding:

- split `core` / `viewer` / `editor` cleanly
- keep scene data normalized and outside the render graph
- use dirty-object recompilation plus an object registry
- use typed interaction events instead of tight component coupling
- make one drag or placement gesture equal one undo step

The first pass should introduce these seams inside the existing demo. The workspace can promote them into standalone packages after the architecture proves out.

## Why This Slice

The current prototype already proves an important vertical loop:

`text -> staged generation session -> compiled object -> grace edits -> release`

The next risk is architectural, not product-level:

- state is still too close to the demo shell
- the viewer still behaves more like a full rebuild path than a projection system
- tool actions are still wired too directly through the HUD layer
- the project does not yet have the right boundaries for a real editor or a scalable world viewer

Pascal is the right reference here because it separates scene truth, render truth, and editor truth clearly.

## Decision

The project should adopt a Pascal-style split now, but only inside the existing demo.

This pass will:

- keep `@3dvibegame/scene-authority-ts` as the current domain package
- keep the current demo as the host app
- introduce internal `core`, `viewer`, and `editor` modules inside the demo
- validate the normalized state, dirty-sync, registry, event bus, and history model
- shape local interaction state so it is keyed by `player_id` from the start

This pass will not:

- create new workspace packages yet
- add direct pointer manipulation
- add multiplayer-aware event plumbing
- turn the demo into a full CAD-style editor

## Proposed Module Split

### `core`

`core` owns normalized scene and session state.

Responsibilities:

- `SceneDocument` shape
- object records keyed by id
- player session state keyed by `player_id`
- generation session state per player
- selection state per player
- tool state per player
- dirty-object tracking
- command history and batch tracking per player
- typed event definitions and event bus
- reducers and selectors

`core` must not import `three`.

### `viewer`

`viewer` owns Three.js projection and render-side caches.

Responsibilities:

- renderer bootstrap
- camera rig
- render loop
- object registry
- render sync systems
- bounds and focus helpers
- object projection from normalized records into `Object3D`s

`viewer` consumes normalized state and dirty flags. It does not own scene truth.

### `editor`

`editor` owns tool-driven authoring actions and UI-facing orchestration.

Responsibilities:

- tool commands such as `submit_prompt`, `move_object_step`, `rotate_object_step`, `scale_object_step`, and `release_object`
- history batch lifecycle
- HUD-facing selectors
- mapping UI intent into typed events or commands

`editor` must not reach directly into the Three scene graph.

## First-Pass File Direction

Inside `packages/scene-runtime-demo/src`, the code should evolve toward:

```txt
src/
  core/
    state/
    reducers/
    selectors/
    history/
    events/
  viewer/
    app/
    registry/
    systems/
    objects/
  editor/
    commands/
    tools/
    ui/
  main.ts
```

This is intentionally shaped like future package seams, but stays local for now.

## Normalized State Model

The demo should stop treating the rendered scene as the easiest place to find truth.

The source of truth should be a normalized `SceneDocument`:

```ts
interface SceneDocument {
  objects_by_id: Record<string, SceneObjectRecord>;
  root_object_ids: string[];
  shared_dirty: SharedDirtyState;
  player_sessions_by_id: Record<string, PlayerSessionState>;
}

interface PlayerSessionState {
  player_id: string;
  selection: SceneSelectionState;
  generation_session: GenerationSessionState | null;
  tool_state: ToolState;
  history: HistoryState;
  camera_dirty: boolean;
  focus_target_object_id?: string | null;
}
```

### `SceneObjectRecord`

Each object record should contain:

- object identity
- authority lifecycle state
- canonical `VoxelBuilderSpec` when available
- compiled runtime artifact cache
- world transform
- derived metadata such as bounds, focus point, and diagnostics

This aligns with the project’s existing decision:

- canonical voxel-aware source is the editable truth
- compiled runtime artifacts are cacheable derivatives

### Shared vs player-scoped state

Shared world state should stay global:

- `objects_by_id`
- `root_object_ids`
- shared compile and render dirty flags
- authority lifecycle state for objects

Local interaction state should be scoped by `player_id`:

- selection
- camera and focus state
- tool state
- generation session state
- undo history and active history batches

This keeps the refactor single-player in behavior while making the state model safe for future multiplayer.

### `SharedDirtyState`

Dirty tracking should be explicit:

- `source_dirty_ids`
- `artifact_dirty_ids`
- `render_dirty_ids`

Per-player UI dirtiness should stay on `PlayerSessionState`, including flags such as `camera_dirty`.

This split allows compile and viewer systems to update incrementally without treating one player’s camera state as shared world truth.

## Dirty-Object Recompilation

The project should borrow Pascal’s most reusable technique directly:

1. a command mutates normalized state
2. the affected object id is marked dirty
3. a compile system rebuilds only the dirty object’s artifact and derived metadata
4. the viewer system looks up the object’s render node in the registry
5. the viewer replaces or updates only that object’s `Group`
6. dirty flags clear after successful sync

For this project, a dirty object may trigger:

- voxel source to compiled artifact rebuild
- bounds refresh
- focus point refresh
- preview diagnostics refresh

Later slices may add collider or thumbnail invalidation on the same pattern.

## Object Registry

The viewer should maintain a minimal registry:

- `object_id -> THREE.Group`
- `object_id -> bounds or focus cache`
- optional `render_class -> Set<object_id>`

The registry exists to avoid scene traversal and to let systems update a known object directly.

That enables:

- focus camera on object id
- refresh one released object in place
- highlight selected object
- find all objects of a certain render class

The registry is a render cache. It is not the source of truth.

## Typed Events

The project should add a typed event layer for tooling and viewer coordination.

The event layer should remain local to the client architecture. It is not the networking protocol.

Initial event categories:

- `generation:*`
- `object:*`
- `viewer:*`
- `tool:*`
- `history:*`

Examples:

- `generation:prompt-submitted`
- `generation:stage-changed`
- `object:selected`
- `object:released`
- `viewer:focus-object`
- `tool:action-requested`
- `history:batch-started`
- `history:batch-committed`

Viewer and editor events should carry `player_id` whenever the action is session-local.

Examples:

- `generation:prompt-submitted` for `player_1`
- `object:selected` for `player_1`
- `viewer:focus-object` for `player_1`
- `history:batch-started` for `player_1`

The important rule is that HUD and tools should communicate through commands and typed events, not direct calls into renderer objects.

## History and Undo Model

The project should support batch-oriented history now, even before direct drag interaction exists.

The history model should distinguish:

- transient updates
- committed updates

History should be owned per player session, not globally.

Rules:

- transient preview state does not create undo entries
- committed tool actions do create undo entries
- a gesture opens one batch
- the batch commits once at gesture end

For the current tool-driven slice, each button press can be a one-step batch. That is enough to validate the architecture before pointer-driven manipulation lands.

This mirrors the Pascal pattern of pausing history during transient motion and resuming only for the final committed step.

For the first pass, the demo can still run with a single default session such as `player_1`, but the state shape should already support multiple local sessions.

## First Implementation Pass

The first pass should refactor the current demo around these seams without expanding feature scope.

### In scope

- internal `core` / `viewer` / `editor` module split
- normalized object records
- dirty-object recompilation
- object registry
- typed event bus
- command history with batch support
- tool-driven actions from the HUD
- preservation of the current prompt-to-grace-to-release loop

### Out of scope

- direct mouse drag manipulation
- hover and pointer adapters
- generalized selection gizmos
- package promotion into new workspaces
- multiplayer-specific editor semantics

## Success Criteria

This slice succeeds if:

- normalized records become the only source of scene truth
- the viewer updates dirty objects incrementally instead of clearing and rebuilding the full world
- HUD actions route through editor commands or typed events
- history supports batch semantics needed for the next drag-based slice
- the current generation-session prototype still works after the refactor

## Follow-On Slice

Once this architecture pass is stable, the next logical slice is direct manipulation:

- pointer selection
- hover and focus events
- move, rotate, and scale gestures
- one gesture equals one undo step

At that point, the project can decide whether to promote the internal modules into standalone workspace packages.
