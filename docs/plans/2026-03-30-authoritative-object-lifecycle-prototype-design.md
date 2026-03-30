# Authoritative Object Lifecycle Prototype Design

## Goal

Build the next validation slice after planning, preview rendering, and deterministic builder benchmarking:

`fixture-backed BuilderSpec -> authoritative object state -> client visualization`

This prototype should prove the Vibe World object lifecycle in the browser without requiring live AI calls or multiplayer networking.

## Why This Slice

The highest remaining risk is not renderer fidelity.
It is whether the current contracts are sufficient to drive the actual object loop described in the Vibe World docs:

- prompt request registered
- AI draft accepted by authority
- object enters grace period
- creator can transform during grace
- object releases to public
- another player can acquire edit lock
- accepted edit increments version and enters cooldown
- timers return the object to public

If this loop is awkward or forces ad hoc state, the project still lacks a stable gameplay core.

## Scope

The prototype will:

- add a TypeScript authority package for object lifecycle contracts and reducers
- consume fixture-backed `BuilderSpec` payloads
- render authoritative objects from builder-backed state, not render-draft previews
- simulate one creator and one second player for lock contention
- expose lifecycle actions in the DOM HUD

The prototype will not:

- call an LLM
- implement real networking
- implement full reducer persistence
- implement terrain or archive flows

## Architecture

### New package

Add `packages/scene-authority-ts/` for:

- `BuilderSpec` mirror types
- object lifecycle state contracts
- reducer-like transition functions
- authority timeline / event log helpers

### Demo integration

Extend `packages/scene-runtime-demo/` so it becomes a lifecycle simulator rather than only a pipeline inspector.

The demo should:

- load a lifecycle scenario fixture
- initialize an authority world and pending AI job
- accept fixture-backed draft submission
- drive object state changes through reducer-style actions
- render authoritative objects through a builder-backed render adapter

## First scenario set

- pine tree create -> grace -> public -> lock -> refine -> cooldown -> public
- barrel triangle grouped create -> grace -> release

These fixtures are enough to validate:

- builder-backed object instantiation
- grouped instance support
- creator-only grace updates
- edit-lock ownership
- cooldown transitions

## UI

Keep the UI compact and state-first:

- scenario selector
- current lifecycle state
- object version
- grace owner or lock owner
- event log
- action buttons for the next valid transitions

The goal is not polished game UI.
The goal is to make authority transitions visible and easy to inspect.

## Success Criteria

The slice succeeds if:

- the client renders from authoritative object state backed by `BuilderSpec`
- grace, release, edit lock, submit edit, and cooldown flows all work from fixtures
- invalid actions are rejected clearly by the authority module
- the whole workspace typechecks and the demo builds
