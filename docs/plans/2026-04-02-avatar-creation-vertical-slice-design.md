# Avatar Creation Vertical Slice Design

Date: 2026-04-02

## Goal

Build the next validation slice as a player-owned avatar creation flow:

`text prompt -> staged avatar draft -> isolated avatar editor preview -> fixture-backed refine submit -> version bump -> immediate cooldown -> public avatar version`

The purpose of this slice is to validate avatar lifecycle and versioning, not world placement and not canonical voxel editing yet.

## Product Framing

This slice is an avatar creation page for the single logged-in player.

That changes the earlier world-object framing in three important ways:

- there is exactly one player session in scope
- the edited thing is the player's avatar slot, not a generic world object
- preview happens in an isolated editor scene rather than the shared world scene

The slice should still reuse the current authority lifecycle and staged generation ideas. It should not invent a separate avatar system unless the current lifecycle proves insufficient.

## Decision

The first avatar slice should validate the real refine and version seam with fixture-backed compiled edits first.

That means:

- start from a text prompt
- produce a staged avatar draft
- render the draft in an isolated editor scene
- allow one explicit refine submit that swaps to a different compiled avatar artifact
- bump version on submit
- pass through cooldown immediately so the player sees the state transition without being blocked

This slice does not yet mutate canonical `VoxelBuilderSpec` directly. That remains the next follow-up slice after lifecycle validation succeeds.

## Why This Is The Next Slice

The current prototype already proves:

- prompt-driven staged generation
- source and compiled artifact visibility
- object selection and focus
- transform editing, lock behavior, and release
- a Pascal-inspired internal `core` / `viewer` / `editor` split

The highest remaining product risk is that the current demo still does not prove true edit submission in the active path:

- submit a revised artifact
- bump version
- enter cooldown
- return to public

That gap is especially important for avatars, because avatar creation is naturally versioned, player-owned, and editor-centric.

## Design Principles

### 1. Validate avatar revision, not just avatar posing

Move, rotate, and scale are useful inspection tools, but they do not prove the important product seam.

This slice should prove that one avatar version can become another avatar version through an explicit submit step.

### 2. Keep the isolated editor scene honest

The avatar editor should not pretend to be the world.

It should:

- preview exactly one avatar at a time
- use stable local framing
- avoid world anchors and world placement logic
- keep focus on recognizability and iteration

### 3. Reuse authority semantics before inventing avatar-specific ones

The current authority package already has the right lifecycle vocabulary:

- draft acceptance
- edit lock
- submit edit
- cooldown
- public state

The slice should reuse that where possible, then note what is awkward for avatar-specific work.

### 4. Stages should stay visible

The Manifold-inspired lesson still applies.

The page should keep generation stages inspectable:

- queued
- planning
- voxel source ready
- compiled artifact ready
- draft ready
- edit locked
- submitted
- cooldown
- public

The user should always understand what state their avatar is in.

## Proposed User Flow

### 1. Prompt

The player enters a prompt describing the avatar they want.

Example:

- "Create a mossy forest guardian avatar with broad shoulders and a glowing chest rune."

### 2. Staged draft

The page shows the existing staged generation timeline:

- prompt accepted
- structured intent
- voxel source ready
- compiled artifact ready

The editor preview renders the accepted avatar draft once the compiled artifact is available.

### 3. Refine submit

The player can choose a refine action from a small fixture-backed set.

For this slice, one refine action is enough if it is visually obvious. Two is better if the fixture cost stays low.

Examples:

- `refine silhouette`
- `add ornament`

The refine action should submit a different compiled artifact for the same avatar slot.

### 4. Version bump

When refine is submitted:

- the avatar artifact swaps visibly
- the object version increments
- the event log records the submit

### 5. Immediate cooldown and public return

The system should still pass through cooldown so the lifecycle remains honest, but the demo should expire it immediately.

That gives the prototype:

- lifecycle parity
- visible versioning
- no unnecessary waiting in the editor

## Scene And UI Model

## Isolated editor scene

The avatar page should render an isolated preview scene with:

- one avatar root
- a neutral ground reference
- stable camera framing
- no world anchors
- no unrelated objects

The scene should bias toward legibility:

- centered avatar
- easy silhouette reading
- easy comparison before and after refine

### Page layout

The page should present:

- prompt input
- stage timeline
- current avatar version and lifecycle state
- current refine actions
- source and compiled artifact inspectors
- authority event log
- avatar preview

This remains an inspector-first tool, not final player-facing polish.

## Data Model Direction

For this slice, the player should conceptually own one avatar slot:

```ts
interface PlayerAvatarSession {
  player_id: string;
  active_avatar_object_id: string | null;
}
```

The actual implementation can continue using the existing normalized scene document and authority object records. The important thing is that the editor treats the active object as the player's avatar, not a generic placed world object.

### What stays the same

- `VoxelBuilderSpec` remains the canonical creative source in project direction
- compiled runtime artifacts remain derived caches
- authority lifecycle still governs draft, edit lock, submit, cooldown, and public
- viewer still renders from normalized records, not from scene graph truth

### What changes in this slice

- the edited object is player-owned and profile-scoped
- placement becomes irrelevant to the prototype
- selection becomes implicit because there is only one avatar object in view
- refine submit becomes the primary action instead of world transform release

## Fixture Strategy

The slice should stay deterministic and fixture-backed.

At minimum it needs:

- one avatar creation fixture for the prompt draft
- one refined avatar fixture for version `2`

Optional but useful:

- a second refine fixture for version `3`

The artifacts should differ enough to make version changes obvious in the viewer.

## Authority Flow

The target lifecycle for one avatar should be:

1. request avatar create
2. submit AI draft
3. avatar enters editable draft state
4. player requests refine
5. authority accepts revised compiled artifact through `submitObjectEdit`
6. version increments
7. state enters cooldown
8. cooldown expires immediately
9. avatar returns to public

This is the exact seam the current demo still does not prove in its active path.

## What This Slice Validates

This slice should answer:

- can avatar generation use the same staged contracts as world objects
- can the player submit a revised avatar version cleanly
- does the viewer swap artifacts without scene reset
- does the version model feel coherent
- does immediate cooldown preserve lifecycle honesty while keeping the tool usable

## What This Slice Deliberately Defers

Do not add these here:

- direct voxel editing
- full avatar customization controls
- multiplayer profile inspection
- persistence or real auth
- world spawn or avatar placement logic
- animation, rigging, or emotes
- side-by-side history comparison

Those are downstream of proving avatar version lifecycle first.

## Success Criteria

The slice succeeds if:

- one player can prompt an avatar from the page
- the page shows the staged generation process clearly
- the avatar renders in an isolated preview scene
- a refine submit swaps to a visibly different compiled artifact
- the avatar version increments
- the event timeline shows submit and cooldown transitions
- cooldown returns immediately to public without extra user action
- the workspace still typechecks and the demo still builds

## Immediate Deliverable

The next working prototype should let one logged-in player:

1. enter an avatar prompt
2. inspect the staged draft pipeline
3. preview the accepted avatar draft in isolation
4. submit one fixture-backed refine
5. watch the avatar visibly update and its version increment
6. see the lifecycle pass through cooldown and return to public immediately

If that loop is clear and reliable, the project will have validated the right seam for a real avatar editor without yet paying the cost of canonical voxel editing UI.
