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

### Phase 2 — Contracts & Backend Definition 🔄 *(current)*
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

### Phase 3 — First Playable (Prototype 1)
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

### Phase 4 — Multiplayer Validation (Prototype 2)
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
