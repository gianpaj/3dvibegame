# Current State

Last updated: 2026-05-31

Use this file as the short project tracker. Keep long reasoning in `docs/plans/` and `/Users/gianpaj_it/github/gianpaj/ideas/vibe-world`.

## Where Things Stand

- `vibe-world` is the product and architecture source of truth: multiplayer rooms, prompt-first creation, object lifecycle, SpacetimeDB authority, and AI worker boundaries.
- `3dvibegame` is the active TypeScript app: Three.js playfield, fixture-backed generation, authority reducers, voxel builder compilation, and the current HUD prototype.
- The current playable wedge is `prompt -> staged generation -> compiled avatar/object -> grace/refine/release -> released object`.
- Multiplayer UI is still prototype state. Presence can read the backend, publish local movement, and render remote player markers when Vite SpacetimeDB env vars are configured; HUD workflow state is explicit, while chat, invite, and most room actions remain local/static.

## Completed

- Core/editor/viewer split in `packages/scene-runtime-demo`.
- Preserved 3D playfield with Three.js scene, camera rig, and object sync.
- `@3dvibegame/scene-authority-ts` package with lifecycle reducers, contracts, and voxel builder compiler.
- Authority reducer lifecycle test harness covering create, grace, release, locks, stale versions, cooldown, permissions, and builder-spec validation.
- `@3dvibegame/world-backend` SpacetimeDB TypeScript module with default world seeding and anonymous join/leave/heartbeat reducers.
- Backend player sessions now include connection identity, transform state, and a validated `move_player` reducer for presence updates.
- Generated SpacetimeDB TypeScript client bindings in the runtime demo.
- Optional runtime demo bridge for backend subscriptions, anonymous join/leave, heartbeat, and live/local HUD status.
- Throttled demo `move_player` publishing from the camera rig plus simple remote player scene markers.
- HUD workflow states now map idle, queued, generating, grace, refining, released, failed, and local-vs-live multiplayer modes.
- Fixture-backed avatar/object generation and refinement flow.
- Spawn HUD and interaction research captured in `docs/spawn-reverse-engineering.md`.
- `scene-builder-bench` in `vibe-world` passes its current pytest suite.
- `scene-planning-bench` packaging fixed so `scene_planning_bench.chart` imports from the package.

## In Progress

- Multiplayer-style HUD over the existing 3D playfield.
- Avatar creation/refine vertical slice.
- Consolidate dirty worktree changes into clear slices: docs, HUD/avatar code, fixtures, and scripts.

## Next Slices

1. Add real chat behavior or mark chat as prototype-only until multiplayer backend work starts.
2. Wire feedback note text alongside thumbs up/down state.
3. Add TypeScript builder parity tests against the `vibe-world` builder benchmark expectations.
4. Start object lifecycle networking: create draft object rows, release, lock, remix, and delete reducers.
5. Choose the next major rendering branch: canonical voxel dirty recompilation or backend object delta rendering.

## Later

- AI worker reliability metrics: clarification rate, refusal rate, parse success, latency, cost, and quality by prompt class.
- Multiplayer load and replay: 20 anonymous players, presence sync, object deltas, reconnect, and lock contention.
- Archive/reset wedge: snapshot a live world, freeze it, and reopen it as read-only exploration.
- Remix safety benchmark: reject destructive edits in public worlds while allowing them in private worlds when enabled.
- Prompt-to-feel playtest: check whether rough draft plus grace period feels fun in real use.

## Verification Snapshot

- `pnpm typecheck`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/scene-authority-ts test`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/world-backend build`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/scene-runtime-demo typecheck`: passing as of 2026-05-31.
- `pnpm demo:build`: passing as of 2026-05-31.
- Browser smoke of `pnpm demo:dev` local fixture mode: passing as of 2026-05-31.
- Browser HUD workflow smoke covered local idle, queued, generating, grace, refining, and released states as of 2026-05-31.
- Temporary local SpacetimeDB smoke: demo joined `vibe-world-dev`, showed `Backend live`, and SQL confirmed `move_player` updated position as of 2026-05-31.
- `vibe-world/prototype/scene-builder-bench`: `uv run pytest` passing as of 2026-05-28.
- `vibe-world/prototype/scene-planning-bench`: `uv run pytest` passing as of 2026-05-28.
