# Avatar Creation Vertical Slice Implementation Plan

Date: 2026-04-02
Depends on: `docs/plans/2026-04-02-avatar-creation-vertical-slice-design.md`

## Goal

Implement a fixture-backed avatar creation page for the logged-in single player that validates:

`text prompt -> staged avatar draft -> isolated preview -> refine submit -> version bump -> immediate cooldown -> public`

The plan should reuse the current demo architecture and authority package rather than create a separate avatar stack.

## Strategy

Do this as a narrow prototype path, not a full app fork.

The implementation should:

- keep using the existing `core` / `viewer` / `editor` seams
- add avatar-specific fixtures and flow orchestration
- validate `submitObjectEdit` and cooldown in the active prototype path
- keep the page isolated from world placement concerns

## Phase 1: Create An Avatar Demo Mode

Add a new demo path or mode that is explicitly avatar-oriented.

### Work

- introduce avatar scenario fixtures in `packages/scene-runtime-demo/src/fixtures/`
- add a new scenario definition in `src/core/fixtures/scenarios.ts` for avatar creation
- ensure avatar scenarios carry:
  - prompt
  - planned intent
  - draft voxel source
  - draft compiled artifact
  - one or more refined compiled artifacts

### Acceptance criteria

- the prototype can load an avatar scenario without world-object assumptions
- the page starts from text prompt rather than a preloaded avatar

## Phase 2: Isolated Avatar Preview Scene

Make the viewer behave like an avatar editor preview, not a world scene.

### Work

- add an isolated preview scene preset with:
  - one neutral floor or pedestal
  - centered focus framing
  - no world anchors like cabin or campfire
- reuse the current object viewer bridge and registry
- ensure one avatar object can be swapped in place without scene reset

### Acceptance criteria

- the avatar always renders in a stable isolated frame
- there are no unrelated world objects in the scene
- artifact swaps do not force a full page reset

## Phase 3: Avatar Session State

Treat the current active object as the player's avatar slot.

### Work

- add a lightweight avatar-session concept in `core`
- keep the implementation backed by the current normalized scene document
- make selection implicit for avatar mode
- remove unnecessary world-object selection UI in avatar mode

### Acceptance criteria

- the avatar page behaves as one-object editing, not general scene browsing
- the active avatar is always unambiguous

## Phase 4: Wire Real Refine Submit

Replace the current lock-and-transform-only behavior with a real fixture-backed edit submit path.

### Work

- add a refine action in `editor` commands
- when refine is triggered:
  - request edit lock if needed
  - call `submitObjectEdit` with the refined compiled artifact
  - update the active object record to the new compiled artifact
  - persist the new artifact in object session cache
- ensure the viewer visibly swaps to the refined avatar shape

### Acceptance criteria

- refine submit changes the rendered avatar artifact
- version increments
- the event timeline includes `submit_object_edit`

## Phase 5: Immediate Cooldown Resolution

Keep lifecycle parity without slowing the tool.

### Work

- after `submitObjectEdit`, immediately trigger the cooldown expiry path
- log both the submit and cooldown return in the stage timeline or authority events
- keep the final state `public`

### Acceptance criteria

- the avatar briefly passes through cooldown in state and events
- the player is not blocked by a timer
- final state returns to `public` deterministically

## Phase 6: Avatar-Oriented HUD

Reshape the current inspector UI around avatar authoring.

### Work

- rename relevant labels from generic object creation to avatar creation
- show:
  - current avatar version
  - current lifecycle state
  - prompt
  - refine actions
  - stage timeline
  - source and compiled artifact summaries
- remove or hide world-object list and placement-oriented messaging in avatar mode

### Acceptance criteria

- the HUD reads as an avatar creation page, not a world editor
- the next valid action is always obvious

## Phase 7: Validation Harness

Prove the slice end to end.

### Manual checks

- prompt an avatar and confirm staged generation appears
- confirm the draft avatar renders in the isolated preview scene
- submit a refine and confirm the avatar visibly changes
- confirm version increments
- confirm cooldown transitions appear and resolve immediately
- confirm the final avatar returns to `public`

### Engineering checks

- run `pnpm typecheck`
- run `pnpm demo:build`

## Files Most Likely To Change

### `packages/scene-runtime-demo`

- `src/core/fixtures/scenarios.ts`
- `src/core/session/generationSession.ts`
- `src/core/state/createSceneDocument.ts`
- `src/editor/commands/createEditorCommands.ts`
- `src/editor/ui/createHud.ts`
- `src/viewer/app/createScene.ts`
- `src/viewer/objects/createAuthorityObject.ts`
- `src/main.ts`
- new avatar fixtures under `src/fixtures/`

### `packages/scene-authority-ts`

- `src/reducers.ts`

Only if the active submit and cooldown path needs a small helper for cleaner avatar-mode orchestration.

## Validation Risks

### Risk 1: The current lifecycle feels too world-oriented

If the current authority model feels awkward for a player-owned avatar slot, note that explicitly rather than hiding it behind UI glue.

### Risk 2: Refine artifact swap is not visually obvious

If the refined avatar looks too similar to the draft, the slice will fail to prove versioning even if the state changes are correct.

### Risk 3: The page still feels like the old world demo

If world-object terminology or selection patterns dominate the page, the prototype will send the wrong product signal.

## Deliberate Deferrals

Do not add these in this implementation:

- direct voxel authoring UI
- drag gizmos
- avatar animation
- save/load persistence
- auth integration
- multiplayer profile viewing
- side-by-side diff viewer

## Done Criteria

This slice is complete when:

- the prototype reads as a single-player avatar creation page
- prompt-driven avatar generation works in a staged way
- refine submit swaps to a new compiled avatar version
- version bump and immediate cooldown are visible and correct
- the code remains aligned with the current `core` / `viewer` / `editor` architecture
