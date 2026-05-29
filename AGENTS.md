# Vibe World — Agent Notes

This document provides orientation for AI agents (and human contributors) working on the Vibe World codebase. Read this before making changes.

---

## Project Status

The game is in **design and early implementation**. The primary implementation artifact is `prototype/scene-planning-bench/` — a benchmark for evaluating LLM scene-planning capabilities. All remaining work is in design documents; no authoritative game backend or client exists yet.

---

## Key V1 Decisions (do not re-open without discussion)

| Decision | Choice |
|---|---|
| Backend | SpacetimeDB |
| AI generation | External worker service (not embedded in backend) |
| Editing scope | Spawned objects only (no terrain carving) |
| Room types | Public (non-destructive remix) and private (destructive edits) |
| Player identity | Temporary anonymous nicknames, no account required |
| Target scale | ~20 concurrent players per room |
| AI pipeline | `prompt → IR → validated builder spec → reducer` |

---

## Repository Layout

```
/
├── AGENTS.md               ← you are here
├── ROADMAP.md              ← phased development plan
├── README.md               ← project overview
├── docs/
│   ├── plans/              ← implementation plan documents
│   └── research/           ← research and landscape notes
├── packages/               ← monorepo packages (TypeScript)
└── prototype/              ← prototype code (do NOT treat as authoritative architecture)
    └── scene-planning-bench/
```

Design documentation from `gianpaj/ideas/vibe-world` is the authoritative source for game rules and architecture decisions. When this codebase and the idea docs contradict each other, the idea docs win unless implementation specs say otherwise.

---

## Documentation Reading Order

For rapid orientation, read in this sequence:

1. `01-product-vision.md` — what this is and why
2. `02-core-game-rules.md` — public/private rules, editing, resets
3. `04-object-and-creation-system.md` — object lifecycle, grace periods
4. `05-technical-architecture.md` — SpacetimeDB, AI worker, delta sync
5. `prototype-v1-scope.md` — V1 scope, success criteria, build order
6. `spacetimedb-v1-schema.md` — DB schema and reducer boundaries
7. `object-state-machine.md` — object lifecycle state transitions
8. `prompt-ir-spec.md` — constrained prompt intermediate representation
9. `reducer-api-spec.md` — authoritative backend surface
10. `ai-worker-contract.md` — AI worker request/response contract

Implementation-focused specs take precedence over conceptual vision documents when they conflict.

---

## AI Pipeline

The AI generation system must stay **outside** the authoritative backend. The flow is:

```
player prompt
  → AI worker (external HTTP service)
  → constrained prompt IR (validated JSON)
  → builder spec (deterministic voxel instructions)
  → SpacetimeDB reducer (object create / edit)
```

The AI worker outputs world-native instructions (category, size, materials, behaviors) — never raw geometry. The engine builds voxel objects deterministically from these instructions. This ensures consistency, moderation, and replayability.

---

## Object Lifecycle

Objects move through these states:

1. **Draft** — creator grace period; only creator can edit or delete
2. **Released (public)** — one editor at a time; 30s cooldown after accepted edit; non-destructive remixing by anyone
3. **Locked** — actively being edited by another player; lock expires on inactivity
4. **Archived** — world has been reset; object is read-only historical record

In private rooms, destructive edits (overwrite, delete by non-creator) are permitted on released objects.

---

## Permissions Model

Roles in descending trust: `platform_admin → host → moderator → trusted_builder → player → visitor`

Public world defaults:
- **Player**: can create objects, remix released objects, move/scale own objects
- **Host**: all player actions + configure world settings, trigger resets, invite moderators
- **Moderator**: all player actions + remove objects, kick players

See `public-world-permission-matrix.md` for the full action-by-role table.

---

## World Settings

Hosts configure per-world settings including: reset schedule, creation rate limits, max concurrent players, object size caps, trusted builder list, curation zone assignments. See `world-settings-schema.md`.

---

## What Agents Should NOT Do

- **Do not** introduce terrain editing, voxel sculpting, or custom world templates — these are explicitly out of V1 scope.
- **Do not** add persistent player accounts, progression systems, or economies.
- **Do not** embed AI generation logic inside SpacetimeDB reducers — it must stay in the external worker service.
- **Do not** allow AI workers to write directly to the DB — they return validated specs, which reducers then apply.
- **Do not** change the core object state machine transitions without updating `object-state-machine.md`.
- **Do not** add behavior scripting for players — deferred post-V1.
- **Do not** treat `prototype/` or `json-render/` as authoritative architecture — they are experimental references.

---

## What Agents Should Do

- **Follow the build order** from `prototype-v1-scope.md`: backend connection → anonymous join → presence → object lifecycle → AI integration → client controls → snapshots → guardrails.
- **Keep reducers thin** — validation and permission checks in reducers, business logic as small pure functions.
- **Validate AI worker output** before passing it to any reducer. Reject malformed or out-of-bounds specs.
- **Use delta sync** — broadcast only object create/edit/delete events, never full world snapshots.
- **Respect grace periods** — new objects are owned exclusively by their creator until released.
- **Update docs** when making significant design changes — spec docs in `gianpaj/ideas/vibe-world` are the source of truth.

---

## Prototype Notes

The `prototype/scene-planning-bench/` folder evaluates whether an LLM can plan a coherent scene from a natural language prompt. It is **not** the game runtime. Do not import from it into game packages.

The `json-render/` folder (if present) is a reference resource only — it does not represent Vibe World architecture.

---

## Open Questions

See `07-open-questions-and-next-steps.md` for the full list. Key unresolved items before Phase 3 begins:

- Exact per-player creation rate limits for public worlds
- Trusted builder role launch timing
- World discovery ranking formula
- Archive visual treatment details

If you encounter a design gap not covered by existing docs, add it to the open questions document and flag it rather than inventing a solution unilaterally.
