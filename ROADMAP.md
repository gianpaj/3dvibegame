# Vibe World — Roadmap

Vibe World is a multiplayer, prompt-first voxel sandbox where players collaboratively create and remix 3D worlds in real time. This roadmap reflects the phased plan from design validation through a live V1 launch.

---

## Vision

> "Describe a change, get a rough draft, lightly refine, release it."

Players enter a shared world, type a natural-language prompt, watch a blocky voxel object materialize, refine it briefly, and release it for others to remix. Hosts launch customized social spaces from templates, establish culture and reset schedules, and build communities around their worlds.

**V1 is a social sandbox** — not a combat game, progression system, or photorealistic engine. The goal is to validate the hardest technical challenges first: latency, multiplayer synchronization, permission handling, and the appeal of collaborative prompt-driven creation.

---

## Milestones

### Phase 0 — Design Foundation ✅
- Product vision, player fantasies, and strategic pillars defined
- Core game rules (public/private worlds, editing, resets, archives)
- World hosting and governance model
- Object and creation system philosophy
- Technical architecture selected (SpacetimeDB + external AI worker)
- Open questions documented and triaged

### Phase 1 — Scene Bench Prototyping ✅
- `prototype/scene-planning-bench/` — LLM scene-planning capability assessment
- Scene-builder benchmark plan and implementation
- Prompt intermediate representation (IR) spec drafted
- AI worker contract defined (request/response boundary)
- Object state machine documented
- Reducer API surface defined
- SpacetimeDB V1 schema proposed

### Phase 1.5 — Authority Lifecycle Test Harness ✅
- Reducer tests added for create → draft/grace → release
- Edit lock acquisition, lock ownership, and lock release covered
- Stale version rejection covered for edit locks and edit submits
- Submit edit → cooldown → public return covered
- Public vs. private destructive delete permissions covered
- Malformed / out-of-bounds builder spec rejection covered
- Tests now serve as the executable contract for future SpacetimeDB reducers

### Phase 2 — Contracts & Backend Definition ✅
- Finalize `prompt-ir-spec` (constrained prompt IR)
- Finalize `reducer-api-spec` (authoritative backend surface)
- Finalize `spacetimedb-v1-schema` (multiplayer schema)
- Finalize `world-settings-schema` (host-configurable settings)
- Finalize `public-world-permission-matrix` (action-by-role model)
- Finalize `ai-worker-contract` (external AI generation service boundary)

### Phase 2.1 — SpacetimeDB Backend Skeleton & Anonymous Join ✅
- SpacetimeDB TypeScript module package added
- One default public development world seeded on module init
- Anonymous player session rows keyed by connection identity
- `join_world`, `leave_world`, and `heartbeat_player` reducers added
- Presence movement, object lifecycle networking, and AI jobs remain out of scope

### Phase 2.2 — SpacetimeDB Player Movement & Presence ✅
- Player session rows now carry connection identity and world transform state
- `move_player` reducer added for approximate authoritative movement updates
- Movement bounds and pitch validation added server-side
- Public `player_session` rows are ready for world-scoped presence subscriptions
- Client movement publishing and remote avatar rendering covered in Phase 2.4

### Phase 2.3 — Generated Client Bindings & Optional Demo Join ✅
- TypeScript client bindings generated from the SpacetimeDB module
- Demo package now depends on the SpacetimeDB TypeScript SDK
- Runtime demo can optionally connect with `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE`
- Optional bridge subscribes to public `world` and `player_session` tables
- Anonymous `join_world`, `leave_world`, and heartbeat calls are wired from the demo
- HUD distinguishes local fixture mode from live backend presence

### Phase 2.4 — Live Movement Presence Markers ✅
- Backend bridge exposes subscribed player transforms to the runtime demo
- Local camera/player transform is published through throttled `move_player` calls
- Remote active players render as simple scene markers under a dedicated presence group
- Presence rendering skips the local player and removes stale/disconnected players
- Object lifecycle networking remains out of scope for the next branch

### Phase 2.5 — HUD Interaction State Coverage ✅
- Runtime HUD maps exact generation stages into player-facing workflow states: idle, queued, generating, grace, refining, released, and failed
- HUD shell exposes workflow and multiplayer mode data attributes for future controls and tests
- Settings panel reports input, panel, workflow, multiplayer, camera, audio, and backend state
- Action dock now has explicit queued/generating, cooldown/refining, released, and failed presentations
- Local fixture mode and optional live backend mode stay visually distinct

### Phase 2.6 — Local Chat Transcript Boundary ✅
- Prompt submissions append persistent local player messages to the HUD chat panel
- Generation stage events append ordered Savi/event messages with timestamps
- Chat panel scrolls to the latest message during active conversation
- Error stage events render distinctly in the local transcript
- Backend multiplayer chat reducers remain deferred until object lifecycle networking starts

### Phase 2.7 — Local Generation Feedback State ✅
- Feedback thumbs up/down state is paired with a persistent note field
- Feedback note is included in HUD interaction state for future telemetry or backend submission
- Feedback resets when the selected object/version changes
- Settings panel summarizes the current local feedback state
- Feedback remains local until AI worker quality metrics and backend persistence are introduced

### Phase 2.8 — Builder Benchmark Parity Tests ✅
- TypeScript voxel compiler output is covered against the checked-in builder benchmark fixture expectations
- Pine tree create, pine tree refine, and barrel triangle fixtures now compile deterministically in tests
- Whole-object `clone_region` layouts compile into repeated `BuilderSpec.instances` when the source can be represented that way
- Compiled `BuilderSpec` artifacts stay on the benchmark `builder_version: "0.1"` contract while preserving voxel-enriched local part metadata

### Phase 2.9 — Backend Object Lifecycle Networking ✅
- SpacetimeDB now exposes public `ai_job`, `world_object`, and `object_lock` rows for subscribed clients
- `request_create_object` and `submit_ai_draft` create pending jobs and grace-period object rows from validated `BuilderSpec` JSON
- Draft/locked transform updates, release, edit lock, edit submit, cancel, grace expiry, edit-lock expiry, and cooldown expiry reducers are wired
- Public-world destructive delete remains rejected by default; the delete reducer is gated on private worlds with destructive edits enabled
- Generated TypeScript client bindings were refreshed for the expanded backend schema and reducer surface
- Local SpacetimeDB smoke covered join → job → draft → release → lock → edit → cooldown expiry → public, plus public delete rejection

### Phase 2.10 — Backend Object Delta Rendering ✅
- Runtime demo live mode now subscribes to public `world_object` rows alongside world and presence rows
- Backend object rows are adapted into the existing `AuthorityWorld` shape used by the Three.js renderer
- Connected backend scenes render live object rows when any renderable objects exist, with local fixture generation retained as the fallback
- Deleted rows and malformed builder specs are skipped by the client-side adapter instead of crashing the scene
- HUD room status now includes the subscribed backend object count

### Phase 2.11 — Backend Lifecycle HUD Controls ✅
- Runtime demo live mode now routes prompt submissions through backend `request_create_object` and `submit_ai_draft` reducers
- The demo uses fixture-backed builder specs as a client-side AI-worker stand-in while keeping generation out of SpacetimeDB reducers
- Live HUD state is projected from subscribed backend object rows so grace, released, edit-lock, and cooldown states drive available actions
- Draft move/rotate/scale, draft release, public refine lock/submit, edit cancel, and demo cooldown expiry are wired to backend reducers
- Browser smoke covered HUD prompt → backend draft → release → public → refine → version 2 public

### Phase 2.12 — Backend Object Artifact Boundary ✅
- Backend object rows now store `source_spec_json` as the canonical editable `VoxelBuilderSpec`
- Existing `builder_spec_json` is retained as the derived current Three.js runtime artifact for renderer compatibility
- Draft and edit submit reducers require both source spec JSON and builder artifact JSON
- Reducers validate source/artifact category, size tier, and operation alignment before mutating object rows
- Generated client bindings were refreshed for the expanded submit reducer payloads and object row shape

### Phase 2.13 — Live Lifecycle HUD Affordances ✅
- Live backend snapshots now surface grace-window, edit-lock, cooldown, public, archived, and deleted object messages
- HUD build metrics show lifecycle status and renderer part count from backend object rows when compiled artifacts are not locally cached
- Action dock now distinguishes unavailable states such as another player's grace window, another editor's lock, cooldown, archive, and removed objects
- Backend prompt/action attempts clear stale error toasts before issuing reducer calls and surface reducer failures in the context toast
- Demo typecheck/build verifies the live affordance projection stays compatible with local fixture mode

### Phase 2.14 — Demo AI Worker Boundary ✅
- Added an explicit `AiWorkerClient` interface for draft and edit artifact generation
- Added a fixture-backed AI worker implementation that returns canonical source specs plus derived builder artifacts
- Backend lifecycle commands now consume worker results instead of importing scenario artifacts directly
- Live reducer calls still pass validated source/artifact JSON to SpacetimeDB; generation remains outside reducers
- Demo typecheck/build verifies the fixture worker boundary stays swappable

### Phase 2.15 — Backend Artifact Debug Visibility ✅
- Backend presence snapshots now expose per-object source/artifact debug payloads separately from render authority state
- HUD Debug panel shows backend canonical source spec summaries and derived runtime artifact summaries for the selected live object
- Collapsed debug details expose `source_spec_json` and `builder_spec_json` for inspection without making renderer artifacts authoritative
- Local fixture debug output remains unchanged when no backend is connected
- Demo typecheck/build verifies backend artifact debug data does not affect rendering

### Phase 2.16 — Multiplayer Lock Contention Smoke ✅
- Added a repeatable `@3dvibegame/world-backend` smoke script that starts an isolated in-memory SpacetimeDB server and publishes the backend module
- The smoke creates two server-issued anonymous CLI identities so Alice and Bob exercise real reducer sender checks
- Alice creates, submits, releases, locks, and publishes an object edit through the backend reducers
- Bob is rejected when trying to acquire a second edit lock, mutate Alice's locked object, or submit Alice's locked edit
- Final assertions confirm the object advances to version 2 cooldown and the active `object_lock` row is cleared

### Phase 2.17 — HTTP AI Worker Client Boundary ✅
- Added an HTTP-backed `AiWorkerClient` implementation selected with `VITE_AI_WORKER_URL`
- The HTTP client posts one create/refine request shape with prompt, target object, base version, and object-context fields
- Worker responses are normalized into canonical `source_spec_json` and derived `builder_spec_json` before reducer submission
- `VITE_AI_WORKER_TIMEOUT_MS` controls request timeout, and worker failure responses surface as HUD/backend action errors
- Fixture generation remains the default offline fallback when no worker URL is configured

### Phase 2.18 — Backend Public Creation Guardrails ✅
- Public rooms now reject a player's second pending create job before the first AI draft is submitted
- Public create requests and draft submissions enforce prototype live-object caps per world and per creator
- Deleted and archived objects do not count against live public-room caps
- Private rooms remain more permissive while exact V1 public rate-limit numbers stay open for tuning
- The two-client backend smoke now also covers pending-create rejection before the lock-contention flow continues

### Phase 2.19 — Multiplayer Replay Smoke Coverage ✅
- Extracted a shared SpacetimeDB smoke harness for isolated in-memory backend runs with server-issued identities
- Added a multiplayer replay smoke with configurable player count through `VIBE_WORLD_SMOKE_PLAYERS`
- Replay coverage now exercises multi-player join, movement presence rows, reconnect/nickname refresh, object create/release deltas, and lock contention
- Reducer calls use an explicit CLI option separator so negative movement coordinates are covered correctly
- Existing lock-contention smoke now reuses the same harness for consistent local backend verification

### Phase 2.20 — Archive & Reset Reducer Coverage ✅
- Added public `world_snapshot` and `snapshot_object` tables for immutable archive metadata and frozen object records
- Added `create_snapshot` and `reset_world` reducers gated to host, moderator, or platform-admin roles
- Snapshot creation copies live objects into archived snapshot rows without mutating the live world
- World reset snapshots first, marks live objects deleted, clears locks, and fails pending AI jobs with `world_reset`
- Generated TypeScript bindings and archive/reset smoke coverage verify read-only snapshot records and live-world wipe behavior

### Phase 2.21 — AI Job Failure & Timeout Reducers ✅
- Added `fail_ai_job` and `expire_ai_job` reducers for pending worker failures and timeouts
- Job owners can fail their own pending jobs, while host/moderator/platform-admin roles can fail jobs in their active world
- Failed jobs preserve structured error codes such as `generation_failed`, `validation_failed`, and `timeout`
- Stale worker draft submissions against failed jobs are rejected by the existing pending-job check
- AI-job failure smoke verifies failed/expired jobs unblock public creation guardrails

### Phase 2.22 — World Settings Guardrail Tuning ✅
- World rows now store configurable live-object, per-player object, and pending-create caps
- Added `update_world_settings` for host/moderator/platform-admin updates to visibility, player cap, guardrail caps, cooldown, grace period, and destructive editing
- Public worlds reject destructive edit settings, and max-player changes cannot strand currently active players
- Public creation guardrails now read cap values from the world row instead of hard-coded constants
- World-settings smoke verifies public guardrail tuning and private destructive delete behavior

### Phase 2.23 — Demo Archive State Visibility ✅
- Runtime demo live mode now subscribes to `world_snapshot` and `snapshot_object` rows
- Backend presence snapshots expose compact archive/reset metadata alongside live object artifacts
- HUD Debug panel shows snapshot count, frozen-object count, deleted live rows, latest reset cycle, and latest reset reason
- Collapsed debug details expose snapshot rows and frozen object rows without feeding archive records into render authority state
- Demo typecheck/build verifies archive state visibility stays compatible with local fixture mode

### Phase 2.24 — Demo AI Job Failure Affordances ✅
- Runtime demo live mode now subscribes to backend `ai_job` rows
- Backend prompt submission reserves a create job before calling the external AI worker
- HTTP worker failures and timeouts map to structured job failure codes and call `fail_ai_job` or `expire_ai_job`
- Failed and pending AI jobs now drive backend HUD workflow states when no live object is selected
- HUD Debug panel summarizes AI job counts, pending jobs, failed jobs, latest status, and latest error code

### Phase 2.25 — Demo World Settings Controls ✅
- Backend bridge exposes `update_world_settings` to the runtime demo command boundary
- HUD Settings panel renders host-facing controls for visibility, player cap, object caps, pending create cap, cooldown, grace period, and destructive edits
- Settings submissions preserve the subscribed world row values and route updates through the authoritative reducer
- Reducer failures surface in the existing context toast, including role checks and public-world destructive edit rejection
- Demo typecheck/build verifies settings controls stay compatible with local fixture mode and optional backend mode

### Phase 2.26 — Demo Snapshot & Reset Controls ✅
- Backend bridge exposes `create_snapshot` and `reset_world` to the runtime demo command boundary
- HUD Settings panel adds host-facing world lifecycle controls for manual snapshots and reset-triggered snapshots
- Reset actions require browser confirmation before calling the authoritative reducer
- Lifecycle status metrics reuse subscribed archive rows so hosts can see live objects, snapshot count, frozen objects, and latest cycle
- Demo typecheck/build verifies snapshot/reset controls stay compatible with local fixture mode and optional backend mode

### Phase 2.27 — Live Backend HUD Smoke ✅
- Published the current backend module to an ephemeral local SpacetimeDB instance
- Runtime demo joined the live backend with generated client bindings and showed `Backend live`
- HUD Settings panel rendered backend world settings plus snapshot/reset lifecycle controls from the subscribed world row
- HUD Debug panel surfaced a failed backend `ai_job` row with `generation_failed`
- Browser smoke used `Snapshot world` and verified snapshot metrics advanced to cycle `#1` without console errors

### Phase 3 — First Playable (Prototype 1) ✅
**Goal:** One small hosted voxel world where players can prompt rough-draft objects into existence.

Sub-phases:

1. **Repo / runtime setup** — monorepo, SpacetimeDB connection, anonymous join flow
2. **Shared rooms & presence** — live player list, room join/leave, temporary nicknames
3. **Object lifecycle rules** — create, grace period, release, lock, remix, delete reducers
4. **AI integration** — connect external AI worker; prompt → IR → validated builder spec → object reducer
5. **Client editing** — move/scale controls, grace-period UI, refinement prompt input
6. **Snapshots & resets** — world reset trigger, archive read-only mode, snapshot storage
7. **Stability & playtests** — rate limits, object caps, cooldowns, inactivity timeouts

**Success criteria:** ~20 concurrent players in a shared room with:
- Prompt-to-draft object generation
- Visible grace periods for creators
- Non-destructive public remixing
- Destructive private editing
- Single-editor locking on public objects
- Edit cooldowns
- Coherent latency / sync

### Phase 3.1 — Archive Read-Only Presentation ✅
- Latest `world_snapshot` rows now project into an archive-only `AuthorityWorld` when no live renderable objects remain after reset
- Snapshot objects render with archived state, no edit actions, and no destructive reducer paths
- Runtime renderer includes archived objects while continuing to exclude deleted live rows
- Archived objects use subdued translucent materials plus an archive ring so reset history is visually distinct from live editable objects
- HUD room status reports latest archive cycle and frozen object count when showing archive mode
- Live backend browser smoke verified reset archive rendering and read-only HUD state

### Phase 3.2 — 20-Player Replay Smoke ✅
- Multiplayer replay smoke now allows the V1 target of 20 anonymous players
- Added `smoke:multiplayer-20` as an explicit backend verification gate
- The 20-player run covers join, active presence rows, movement deltas, reconnect nickname refresh, object create/release deltas, and edit-lock contention
- This begins turning the Phase 3 success criteria into repeatable local gates rather than temporary manual checks

### Phase 3.3 — First-Playable Flow Smoke ✅
- Added `smoke:first-playable-flow` for the core V1 story: prompt request, AI draft submit, grace transform, release, public remix, cooldown, and final public return
- The smoke records local prompt-to-draft elapsed time for the reducer/fixture path
- Public-world destructive delete remains rejected during the flow, preserving non-destructive remixing
- The gate uses two anonymous players so creator and remixer roles exercise real sender permissions

### Phase 3.4 — Live First-Playable Browser Smoke ✅
- Added `smoke:live-first-playable` for the runtime demo live path with a temporary SpacetimeDB backend, Vite server, and Chromium CDP driver
- The smoke verifies browser-visible live connection, prompt-to-grace release affordance, public release, remix to version 2, and final released UI state
- Browser prompt-to-draft elapsed time is logged so local playtest runs have a repeatable latency signal
- The gate fails on browser runtime or console errors while avoiding a new browser automation dependency

### Phase 3.5 — Archive Browser Read-Only Smoke ✅
- Extracted the live browser smoke lifecycle into a shared script harness for temporary backend, Vite, Chromium, CDP, and cleanup
- Added `smoke:live-archive-readonly` to seed a reset world, open the live runtime demo, and verify archive `#1` renders as frozen read-only state
- The smoke checks that archived objects expose no edit action buttons and that the HUD reports the archived object as read-only
- Backend assertions confirm the live object is deleted while the snapshot row keeps archived state and captured public state

### Phase 3.6 — Private Destructive Editing Smoke ✅
- Added `smoke:private-destructive-edit` as an explicit Phase 3 gate for private-room destructive editing
- Public rooms and private rooms without destructive edits enabled reject released-object deletes
- Private rooms with destructive edits enabled allow a non-creator player to delete a released object
- This separates the V1 private-room success criterion from the broader world-settings smoke

### Phase 3.7 — Prompt-to-Feel Playtest Notes ✅
- Live browser smokes show the fixture-backed path is mechanically responsive: recent local runs reached grace in roughly 115-123 ms
- That latency is not real AI latency; it only validates browser, reducer, fixture-worker, and sync overhead
- The grace/release/remix loop is legible in the HUD: draft ready, release, public refine, and v2 public return all have visible states
- Main feel risks remain: transforms are button-level rather than direct manipulation, prompt variety is still fixture-limited, and the avatar-specific copy needs a world-object pass
- The next product-risk slice should connect a real create-only external AI worker or run human playtests with varied prompt outputs before treating prompt-to-feel as validated

### Phase 3.8 — Create-Only External AI Worker ✅
- Added `@3dvibegame/ai-worker` as an external Node TypeScript service with `POST /generate`, `GET /healthz`, and CORS preflight support
- The first worker slice supports create only; refine and remix return `unsupported_request` so reducers remain authoritative and no worker writes to SpacetimeDB
- Gemini integration uses the current AI SDK structured-output path to produce a constrained create plan, then the worker deterministically converts that plan into `VoxelBuilderSpec` and compiled `BuilderSpec`
- Added a fake plan generator, unit tests, and `smoke:fake-create` so CI/local verification does not require a Gemini key
- Runtime demo configuration now uses the HTTP worker for create drafts when `VITE_AI_WORKER_URL` is set while keeping refine fixture-backed for this slice

### Phase 3.9 — HTTP AI Worker Browser Smoke ✅
- Added `smoke:live-http-ai-worker` to start the fake external AI worker, live SpacetimeDB backend, Vite demo, and Chromium browser together
- The browser prompt path now verifies `VITE_AI_WORKER_URL` create requests reach the external worker and return to backend grace state
- The smoke releases the generated object and asserts backend rows show a completed create job and public `pine_tree` object
- This closes the local no-key path for testing the external worker boundary end to end

### Phase 3.10 — Optional Gemini Live Smoke ✅
- Added `smoke:gemini-live` for `@3dvibegame/ai-worker` to exercise the real Gemini-backed create path when `GOOGLE_GENERATIVE_AI_API_KEY` is present
- The smoke starts the worker in-process, posts one create prompt, and validates completed source and builder specs
- Without a Gemini key, the smoke exits successfully with an explicit skip message so local and CI runs remain deterministic

### Phase 3.11 — Aggregate Phase 3 Smoke Suite ✅
- Added root `phase3:smoke` to run the Phase 3 backend, AI-worker, and live browser gates in a fixed order
- The suite covers first-playable flow, 20-player replay, lock contention, private destructive editing, archive/reset, AI job failure, world settings, fake AI worker create, optional Gemini live smoke, and live browser flows
- This gives Phase 3 one command for pre-close regression checks while preserving the focused smoke scripts for debugging

### Phase 3.12 — World-Object HUD Copy Polish ✅
- Replaced the most visible avatar-specific HUD labels with object/world wording in the room title, action dock, build panel subtitle, local room status, and player status copy
- Live first-playable browser smoke now reaches the released remix state with `Object actions`, keeping the first playable framed as world object creation rather than avatar editing
- Direct manipulation remains a later playtest polish candidate, but Phase 3 now has the reducer, browser, AI-worker, and copy gates needed to close the prototype

### Phase 4 — Multiplayer Validation (Prototype 2) 🔄 *(current)*
- Multi-host world network (federated worlds model)
- Trusted builder role (host-elevated players)
- World discovery — surface engaging worlds using player count, retention, and moderation stability
- Archive UX — visually distinct read-only historical snapshot presentation
- Expanded permission model (moderator, builder tiers)

### Phase 5 — V1 Hardening & Launch
- Rate limiting and abuse guardrails
- World settings UI for hosts (presets, reset schedules, permission toggles)
- Curation zones (build / gallery / chaos areas) — *candidate V2 feature*
- Behavior scripting for players — *deferred post-V1*
- Terrain editing / voxel sculpting — *deferred post-V1*
- Persistent economy — *deferred post-V1*
- Combat gameplay — *deferred post-V1*

---

## Technical Stack

| Layer | Choice |
|---|---|
| Authoritative backend | SpacetimeDB |
| AI generation | External worker service (stateless, validated output) |
| Client rendering | Web client (Three.js / React Three Fiber, TypeScript) |
| Object representation | Constrained prompt IR → deterministic voxel builder |
| Sync | Delta-based (object create / edit / delete events) |

**AI pipeline:**
```
player prompt → AI worker → constrained prompt IR
  → validated builder spec → authoritative object reducer
```

---

## Open Questions (to resolve by Phase 3)

| # | Question | Current lean |
|---|---|---|
| 1 | Per-player creation rate limits in public worlds | Soft limits; private worlds more permissive |
| 2 | In-world command expressiveness | Highly constrained in V1 |
| 3 | Player behavior customization | Preset libraries only; no general scripting |
| 4 | Terrain vs. object editing scope | Objects first; terrain deferred |
| 5 | World discovery ranking | Player count + retention + moderation stability |
| 6 | Archive visual treatment | Strong visual distinction from live mode |
| 7 | Trusted builder role timing | Yes, but defer from initial release |
| 8 | Curation zones (build/gallery/chaos) | Likely V2 |
| 9 | AI model strategy (live vs. offline) | LLM for intent parsing; deterministic engine assembly |

---

## Key Documents

| Document | Purpose |
|---|---|
| `01-product-vision.md` | Product thesis, pillars, player fantasy |
| `02-core-game-rules.md` | Public/private rules, editing, resets, archive |
| `03-worlds-hosting-and-governance.md` | World model, host powers, presets, persistence |
| `04-object-and-creation-system.md` | Object philosophy, grace periods, prompt-first creation |
| `05-technical-architecture.md` | Authoritative multiplayer stack, AI pipeline |
| `06-research-landscape-3d-voxel-ai.md` | External research and technology landscape |
| `07-open-questions-and-next-steps.md` | Design questions and prototype roadmap |
| `prototype-v1-scope.md` | High-level scope and phased implementation plan |
| `spacetimedb-v1-schema.md` | First multiplayer schema and reducer boundary |
| `prompt-ir-spec.md` | Constrained prompt intermediate representation |
| `reducer-api-spec.md` | High-level reducer surface for authoritative backend |
| `object-state-machine.md` | Authoritative live object lifecycle |
| `ai-worker-contract.md` | Request/response boundary for AI generation service |
| `public-world-permission-matrix.md` | Action-by-role permission model |
| `world-settings-schema.md` | Host-configurable world settings for V1 |
| `archive-ux-spec.md` | Archive-mode experience and read-only presentation |
| `client-interaction-model.md` | Player-facing interaction flow |
