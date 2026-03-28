# Scene Runtime Three Renderer Prototype Design

## Goal

Replace the current `packages/scene-runtime-demo` React Three Fiber demo with a plain Three.js prototype that proves the runtime seam:

`artifact JSON -> parsed response -> normalized scene plan -> render drafts -> Three renderer`

The prototype is not a multiplayer client or live AI caller. It is a renderer-facing contract inspector for the Vibe World rough-draft creation pipeline.

## Why This Slice

Vibe World is a prompt-first, chunky, voxel-native social sandbox. The immediate product risk is not "can we render a fancy 3D world?" but "can a constrained planning pipeline produce deterministic rough drafts that a game renderer can consume cleanly?"

This prototype focuses on the client boundary where the normalized scene plan becomes renderer input.

## Scope

The replacement demo will:

- load the existing checked-in artifact fixtures
- surface the parsed-response, normalized-plan, and render-draft stages in the UI
- consume normalized/runtime data from `@3dvibegame/scene-runtime-ts`
- render rough-draft objects in a plain Three.js scene with direct loop control
- keep the UI in DOM overlays instead of WebGL

The replacement demo will not:

- call an LLM
- implement multiplayer or authoritative world state
- add physics
- attempt final-art rendering

## Architecture

The demo will follow a small `Three Webgl Game`-style split:

- `src/main.ts`: bootstraps styles, HUD, runtime pipeline selection, and renderer lifecycle
- `src/runtime/`: artifact-to-pipeline helpers
- `src/render/app/`: renderer, scene, camera, loop, resize, and controls
- `src/render/adapters/`: bridge from render drafts to scene objects
- `src/render/objects/`: primitive mesh factories and static reference anchors
- `src/ui/`: DOM HUD and pipeline diagnostics

The scene graph is a view layer only. Runtime data remains source of truth for what should be shown.

## Scene Design

The viewport will show a sparse inspection diorama:

- a ground plane and grid-like floor treatment
- a few static reference anchors such as `cabin_1` and `campfire_1`
- spawned rough-draft meshes built from `RenderDraftSpec`
- compact overlay chips for fixture selection and pipeline diagnostics

The look should stay obviously draft-oriented and low-chrome: chunky primitives, simple palette, readable lighting, no heavy post-processing.

## Data Flow

For each selected fixture:

1. Load and validate artifact JSON.
2. Read `parsed_response`.
3. Use `normalized_plan` if present, otherwise derive it when possible.
4. Use `render_drafts` if present, otherwise derive them from the normalized plan.
5. Adapt the render drafts into scene meshes.
6. Update the HUD with stage summaries, warnings, and clarification/refusal details.

This preserves parity with the current Python-first contract while proving the exact renderer handoff that the future client needs.

## Success Criteria

The prototype succeeds if:

- the package no longer depends on React or React Three Fiber
- fixture changes update the plain Three scene correctly
- grouped layouts and relative anchors are visible in-world
- clarification fixtures surface pipeline state without trying to fabricate geometry
- the demo makes the contract stages legible to a developer inspecting runtime outputs
