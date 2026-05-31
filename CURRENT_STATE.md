# Current State

Last updated: 2026-05-31

Use this file as the short project tracker. Keep long reasoning in `docs/plans/` and `/Users/gianpaj_it/github/gianpaj/ideas/vibe-world`.

## Where Things Stand

- `vibe-world` is the product and architecture source of truth: multiplayer rooms, prompt-first creation, object lifecycle, SpacetimeDB authority, and AI worker boundaries.
- `3dvibegame` is the active TypeScript app: Three.js playfield, fixture-backed generation, authority reducers, voxel builder compilation, and the current HUD prototype.
- The current playable wedge is `prompt -> staged generation -> compiled avatar/object -> grace/refine/release -> released object`.
- Multiplayer UI is still prototype state. Presence can read the backend, publish local movement, render remote player markers, render subscribed backend object rows, and route prompt/object lifecycle actions to reducers when Vite SpacetimeDB env vars are configured; HUD workflow, local chat transcript, and local generation feedback are explicit, while invite and room management remain local/static.

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
- Backend object lifecycle networking now has `ai_job`, `world_object`, and `object_lock` rows plus create, draft submit, transform, release, lock, edit submit, cancel, expiry, and gated delete reducers.
- Backend `world_object` rows now distinguish canonical `source_spec_json` (`VoxelBuilderSpec`) from derived `builder_spec_json` (current renderer artifact).
- Runtime demo live mode now subscribes to backend `world_object` rows and maps renderable rows into the existing Three.js authority-world renderer.
- Runtime demo live mode now routes HUD prompt, draft transform, release, and public refine actions through backend lifecycle reducers using fixture-backed builder specs as the demo AI-worker stand-in.
- Runtime demo live HUD now shows backend lifecycle status for grace windows, edit locks, cooldowns, archived/deleted rows, and reducer errors.
- Runtime demo now has an explicit fixture-backed `AiWorkerClient` boundary that returns canonical source specs plus derived builder artifacts before reducer submission.
- Runtime demo can swap that boundary to an HTTP AI worker with `VITE_AI_WORKER_URL`, while fixture generation remains the offline default.
- Runtime demo now records backend create-job failures/timeouts when the HTTP AI worker fails or returns invalid artifacts.
- Runtime demo Debug panel now exposes backend canonical source specs and derived renderer artifacts for the selected live object without feeding them back into render authority state.
- World backend now has a repeatable two-client lock-contention smoke that uses separate server-issued anonymous identities for Alice and Bob.
- World backend now has a configurable multiplayer replay smoke for joins, movement presence, reconnect, object deltas, and lock contention.
- Public-room object creation now rejects duplicate pending create jobs and enforces prototype live-object caps per world and per creator.
- Backend archive/reset reducers now snapshot live objects into immutable archive rows, wipe live objects on reset, clear locks, and fail pending AI jobs.
- Runtime demo live mode now surfaces backend archive/reset rows in bridge snapshots and the HUD Debug panel.
- Backend AI jobs can now be explicitly failed or expired so stale worker responses are rejected and pending-job guardrails unblock.
- Host-level world settings can now tune visibility, player caps, live-object caps, pending-create caps, cooldowns, grace periods, and destructive edits.
- Runtime demo Settings panel now submits host-facing world settings updates through the backend reducer.
- Runtime demo Settings panel now exposes host-facing world snapshot and reset actions through backend reducers.
- HUD workflow states now map idle, queued, generating, grace, refining, released, failed, and local-vs-live multiplayer modes.
- HUD chat panel now keeps a local transcript of player prompts and generation stage events; backend chat reducers are deferred.
- HUD generation feedback now stores thumbs up/down plus a note per object version in local state.
- TypeScript voxel compiler parity tests now cover the pine tree, pine tree refine, and barrel triangle builder benchmark fixture expectations.
- Fixture-backed avatar/object generation and refinement flow.
- Spawn HUD and interaction research captured in `docs/spawn-reverse-engineering.md`.
- `scene-builder-bench` in `vibe-world` passes its current pytest suite.
- `scene-planning-bench` packaging fixed so `scene_planning_bench.chart` imports from the package.

## In Progress

- Multiplayer-style HUD over the existing 3D playfield.
- Avatar creation/refine vertical slice.
- Consolidate dirty worktree changes into clear slices: docs, HUD/avatar code, fixtures, and scripts.

## Next Slices

1. Add a live backend browser smoke for archive/reset visibility, AI job failures, world settings controls, and reset controls.

## Later

- AI worker reliability metrics: clarification rate, refusal rate, parse success, latency, cost, and quality by prompt class.
- Multiplayer load and replay: 20 anonymous players, presence sync, object deltas, reconnect, and lock contention.
- Archive/reset wedge: snapshot a live world, freeze it, and reopen it as read-only exploration.
- Remix safety benchmark: reject destructive edits in public worlds while allowing them in private worlds when enabled.
- Prompt-to-feel playtest: check whether rough draft plus grace period feels fun in real use.

## Verification Snapshot

- `pnpm typecheck`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/scene-authority-ts test`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/scene-authority-ts typecheck`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/world-backend build`: passing as of 2026-05-31.
- `pnpm --filter @3dvibegame/scene-runtime-demo typecheck`: passing as of 2026-05-31.
- `pnpm demo:build`: passing as of 2026-05-31.
- Backend object artifact boundary typecheck/build: passing as of 2026-05-31.
- Temporary backend artifact-boundary smoke: `submit_ai_draft` accepted paired `source_spec_json` and `builder_spec_json` and created a grace object as of 2026-05-31.
- Live lifecycle HUD affordance typecheck/build: passing as of 2026-05-31.
- Fixture AI worker boundary typecheck/build: passing as of 2026-05-31.
- HTTP AI worker client boundary typecheck/build: passing as of 2026-05-31.
- Demo AI job failure affordance typecheck/build: passing as of 2026-05-31.
- Backend artifact debug visibility typecheck/build: passing as of 2026-05-31.
- Two-client backend lock-contention smoke: `pnpm --filter @3dvibegame/world-backend smoke:lock-contention` passing as of 2026-05-31.
- Multiplayer backend replay smoke: `pnpm --filter @3dvibegame/world-backend smoke:multiplayer-replay` passing as of 2026-05-31.
- Backend archive/reset smoke: `pnpm --filter @3dvibegame/world-backend smoke:archive-reset` passing as of 2026-05-31.
- Backend AI job failure smoke: `pnpm --filter @3dvibegame/world-backend smoke:ai-job-failure` passing as of 2026-05-31.
- Backend world settings smoke: `pnpm --filter @3dvibegame/world-backend smoke:world-settings` passing as of 2026-05-31.
- Demo archive state visibility typecheck/build: passing as of 2026-05-31.
- Demo world settings controls typecheck/build: passing as of 2026-05-31.
- Demo snapshot/reset controls typecheck/build: passing as of 2026-05-31.
- Browser settings-panel smoke in local fixture mode: passing as of 2026-05-31.
- Public creation guardrail smoke coverage: pending duplicate create rejection passing as of 2026-05-31.
- Backend object delta rendering adapter typecheck/build: passing as of 2026-05-31.
- Temporary live backend render smoke: seeded one `world_object` row and browser HUD showed `public room - 1/20 online - 1 object` as of 2026-05-31.
- Temporary live backend control smoke: browser HUD prompt created a backend draft, release moved it to public, and refine moved it to version 2 public as of 2026-05-31.
- Temporary local SpacetimeDB object lifecycle smoke: join, job, draft, release, edit lock, submit edit, cooldown expiry, and public delete rejection passing as of 2026-05-31.
- Browser smoke of `pnpm demo:dev` local fixture mode: passing as of 2026-05-31.
- Browser HUD workflow smoke covered local idle, queued, generating, grace, refining, and released states as of 2026-05-31.
- Browser chat transcript smoke confirmed local player and event messages persist and scroll to latest as of 2026-05-31.
- Browser feedback smoke confirmed vote and note state stay paired in the released-object feedback card as of 2026-05-31.
- Temporary local SpacetimeDB presence smoke: demo joined `vibe-world-dev`, showed `Backend live`, and SQL confirmed `move_player` updated position as of 2026-05-31.
- `vibe-world/prototype/scene-builder-bench`: `uv run pytest` passing as of 2026-05-28.
- `vibe-world/prototype/scene-planning-bench`: `uv run pytest` passing as of 2026-05-28.
