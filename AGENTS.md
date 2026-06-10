# Vibe World — Agent Notes

This document provides orientation for AI agents (and human contributors) working on the Vibe World codebase. Read this before making changes.

---

## Project Status

The game is **in active development**. The core multiplayer stack is implemented and deployed:

- `packages/world-backend` — SpacetimeDB module (TypeScript); runs at `stdb.3dvibegame.com`
- `packages/3dvibegame-web` — React + R3F player app; deployed on Cloudflare Pages
- `packages/ai-worker` — Cloudflare Worker that compiles Gemini voxel plans into geometry
- `packages/scene-authority-ts` — shared authority logic (pure reducers, compiler, contracts)
- `packages/ai-planning` — AI prompt contracts, voxel schema, system prompts

See `packages/3dvibegame-web/AGENTS.md` for package-specific dev/test/deploy instructions.

---

## Key V1 Decisions (do not re-open without discussion)

| Decision | Choice |
|---|---|
| Backend | SpacetimeDB (TypeScript module) |
| AI generation | External worker service (not embedded in backend) |
| Editing scope | Spawned objects only (no terrain carving) |
| Room types | Public (non-destructive remix) and private (destructive edits) |
| Player identity | Temporary anonymous nicknames, no account required |
| Target scale | ~20 concurrent players per room |
| AI pipeline | `prompt → voxel core (Gemini) → builder spec → SpacetimeDB reducer` |
| Voxel material colors | Resolved by `color_hint` in source spec; renderer maps to hex via `resolveMaterialColor` |
| Avatars | Third-person voxel avatars; non-solid players; client-side capsule-vs-AABB collision (no physics engine); body stored in `player_avatar`, outside the object lifecycle |

---

## Repository Layout

```
/
├── AGENTS.md                     ← you are here
├── docs/deploy-backend.md        ← Coolify deploy guide (SpacetimeDB + AI worker)
├── packages/
│   ├── 3dvibegame-web/           ← player app (React + R3F + SpacetimeDB SDK)
│   │   └── AGENTS.md             ← dev / test / deploy for this package
│   ├── world-backend/            ← SpacetimeDB module
│   ├── ai-worker/                ← Cloudflare Worker (/compile endpoint)
│   ├── scene-authority-ts/       ← shared pure reducers + voxel compiler
│   └── ai-planning/              ← Gemini prompt contracts + voxel schema
└── prototype/                    ← old bench, NOT authoritative architecture
```

---

## AI Pipeline

```
player prompt
  → Gemini (browser or server) → VoxelCore (validated JSON, includes quantity)
  → /compile or buildVoxelResponse → VoxelBuilderSpec + BuilderSpec
  → submit_ai_draft reducer → world object (grace state)
```

- The AI worker stays **outside** SpacetimeDB — it returns validated specs, reducers apply them.
- `VoxelCore.quantity` (1–4) tells the client how many independent objects to create. The client calls the AI once and submits N jobs, releasing all but the first immediately.
- `color_hint` on a material entry overrides the material name when the voxel compiler builds parts — use it to produce colored objects (e.g. `material_id: "jelly", color_hint: "yellow"` → yellow blob).

---

## Object Lifecycle

```
pending job → grace (creator can reposition) → public → edit_locked → cooldown → public
                                                       → archived (after world reset)
                                                       → deleted
```

- Grace period: only the creator can move/delete. Released via `release_object` reducer or automatic release (e.g. batch creation of extra copies).
- Edit lock: one player at a time; 30 s auto-expiry; `release_edit_lock` or `submit_object_edit` clears it.
- Private rooms: destructive edits (overwrite, delete by non-creator) are permitted on public objects.

---

## Avatars

Players are embodied as third-person voxel avatars (design spec: `docs/superpowers/specs/2026-06-10-voxel-avatars-design.md`).

- Movement: client-side character controller (WASD + Space jump) in `3dvibegame-web/src/scene/avatar/`; capsule-vs-AABB collision against world-object bounds via a module-level `CollisionRegistry`; other players are non-solid.
- Sync: existing `move_player` reducer, throttled ≤10 Hz and only-on-change; remote avatars interpolate (~150 ms) and derive their procedural gait from interpolated velocity.
- Body: `player_avatar` table (keyed by identity, persists across sessions) + `set_avatar_spec` reducer (JSON validation, ≤8×12×8 geometry clamp, scale 0.25–4, 10 s rate limit). Default hue-tinted body when no row exists or the stored spec fails to parse — never bodiless.
- Size: rendered size comes ONLY from the explicit `player_avatar.scale` (1 = human height 1.8 u, up to 4×) — never from geometry, which is always normalized. The AI sets `scale` only when the player explicitly asks ("make me 4 times larger"); omitting it preserves the current scale. The physics capsule stays 1.8 u regardless — oversized bodies are cosmetic.
- Editing: "Edit avatar" in PlayerList → prompt box avatar mode → same Gemini/compile pipeline → `set_avatar_spec`. Avatars do **not** use locks, grace periods, cooldowns, or any object-lifecycle state.
- Gait is procedural and distance-driven (`phase += speed * dt`) so it works on any generated shape — do not add rigging/part-tagging without discussion.

---

## Permissions

Roles (descending trust): `platform_admin → host → moderator → trusted_builder → player → visitor`

- **Player**: create objects, move/scale own objects, remix released objects
- **Host**: all player actions + world settings, resets, invite moderators
- **Moderator**: all player actions + remove objects, kick players

---

## What Agents Should NOT Do

- Do not introduce terrain editing, voxel sculpting, or custom world templates.
- Do not add persistent player accounts, progression systems, or economies.
- Do not embed AI generation logic inside SpacetimeDB reducers.
- Do not let AI workers write directly to the DB — they return specs, reducers apply them.
- Do not treat `prototype/` as authoritative architecture.

---

## What Agents Should Do

- Keep reducers thin — validation + permission checks in reducers, business logic in pure functions.
- Validate AI worker output before passing to any reducer.
- Respect grace periods — batch creation auto-releases extra copies so only one is active.
- When changing the voxel compiler or renderer color logic, verify `color_hint` flows end-to-end.
- Backend schema changes (SpacetimeDB reducers) require updating the auto-generated module bindings in `3dvibegame-web/src/backend/module_bindings/` manually until `spacetime generate` is re-run.
