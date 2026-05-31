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

1. Add live-mode client affordances for grace timers, edit locks, cooldowns, stale-version rejection, and reducer error recovery.
2. Replace the fixture-backed demo AI-worker stand-in with an explicit worker boundary adapter.
3. Add backend/source artifact debug visibility in the HUD without making renderer artifacts authoritative.

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
