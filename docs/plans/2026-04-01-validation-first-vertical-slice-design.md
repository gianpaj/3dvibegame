# Validation-First Vertical Slice Design

Date: 2026-04-01

## Goal

Build the next prototype as one narrow but real object loop:

`text request -> structured generation session -> VoxelBuilderSpec -> compiled runtime artifact -> inspect/edit during grace -> release`

The purpose of this slice is not final rendering quality and not broad feature coverage. The purpose is to validate the hardest product seams with a single-player flow that still feels like a working prototype.

## Product Direction

The project should optimize for strongest validation without drifting into infrastructure-first work.

That means:

- keep `VoxelBuilderSpec` as the canonical editable source
- keep compiled runtime artifacts as derived caches
- keep the renderer as a projection of object state, not the source of truth
- prove the single-player create and release loop before adding multiplayer presence

## Why This Is The Next Slice

The repo already has the right building blocks in motion:

- voxel-aware authoring contracts
- a compiler from voxel source to the current `BuilderSpec`
- an authority reducer for grace, public, lock, and cooldown states
- a plain Three.js demo that can render authoritative objects

The main gap is that these pieces still feel like separate prototypes.

The next slice should connect them into one visible flow that starts with player text and ends with a released world object.

## Design Principles

### 1. Validate the real seam

The important seam is not "can we render primitives?" It is "can a player request become a staged object session that the game can inspect, compile, edit, and release?"

### 2. Prefer staged contracts over hidden work

Borrow from the `Manifold` review:

- expose generation stages
- show the best currently available representation
- make long-running work inspectable

The client should understand stages such as planning, voxel source ready, and compiled artifact ready. It should not need to understand generator internals.

### 3. Separate source, runtime, and tool state

Borrow from the `Pascal` review:

- source data stays normalized
- rendered objects are projections
- interaction flows through explicit state and typed actions

For this slice, a lightweight version of that split is enough. We do not need a full CAD editor architecture yet.

### 4. Defer multiplayer, not clarity

Single-player first does not mean "fake the important parts." It means use one creator loop to prove:

- text input
- prompt-to-object staging
- draft inspection
- grace-period transforms
- authoritative release

## Proposed Slice Map

### Text

Add a generation-session contract that represents:

- source prompt
- matched fixture or generation recipe
- structured object intent
- staged progress
- generation diagnostics

The first implementation can stay fixture-backed and deterministic. The important part is shaping the client and runtime boundary correctly.

### Generate / Edit Model

Treat `VoxelBuilderSpec` as the canonical creative source and compile it into the current `BuilderSpec` runtime artifact.

The first vertical slice only needs a narrow set of creator actions during grace:

- move
- rotate
- scale
- release

This is enough to validate semantic authoring plus object-level world transforms without building the full editor yet.

### Render

Keep the current plain Three.js runtime and improve it as an inspector shell, not a final game client.

The viewport should render authoritative objects once the compiled artifact is accepted. The HUD should show the earlier stages:

- queued
- planning
- voxel source ready
- compiled artifact ready
- grace
- released

This gives the prototype progressive legibility without forcing the renderer to consume every intermediate representation directly.

## Recommended Implementation Order

### 1. Generation session seam

Add explicit TypeScript contracts for staged prompt generation and wire the demo around them.

Success criteria:

- prompt submission creates a visible staged session
- the client shows planning and compilation stages before release
- the session can fail or clarify without inventing geometry

### 2. Canonical source to compiled artifact path

Make the demo consume voxel source fixtures as the editable source and compile them into the current runtime artifact.

Success criteria:

- the HUD shows both source and compiled forms
- diagnostics survive compilation
- the accepted authoritative object comes from the compiled artifact, not ad hoc render data

### 3. Single-player grace loop

Replace the action-simulator feel with a creator loop:

- enter prompt
- receive staged draft
- move, rotate, or scale during grace
- release object

Success criteria:

- one prompt leads to one object draft
- the player can modify the draft before release
- release moves the object into stable public state

### 4. Lightweight editor architecture

Only after the vertical slice works:

- split world, viewer, and tool state more clearly
- add object registry helpers
- add dirty-object recompilation and preview refresh
- add one-gesture-one-commit interaction behavior

This is the first Pascal-inspired cleanup step, not the first milestone.

### 5. Validation harnesses

Once the slice is real, measure it.

Track:

- prompt to source-spec success rate
- compile determinism
- compile latency
- recognizability of draft objects
- edit continuity between create and refine
- frame cost with many released objects

## Deliberate Deferrals

This slice should not block on:

- multiplayer presence
- real AI workers
- final mesh generation
- terrain systems
- archive or reset flows
- full edit-lock UI for a rival player

Those systems should come after the single-player loop proves that the product core is worth scaling.

## Immediate Deliverable

The next working prototype should let one player:

1. enter a prompt
2. watch a fixture-backed staged generation session
3. inspect the resulting voxel-native source and compiled artifact
4. adjust the draft during grace
5. release the object into the world

If that loop is clear, deterministic, and legible, the project will have a real foundation for later multiplayer and AI worker work.
