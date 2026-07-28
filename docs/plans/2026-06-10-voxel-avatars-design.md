# Voxel Avatars — Design Spec

**Date:** 2026-06-10
**Status:** Approved
**Scope:** `packages/3dvibegame-web` (most work), `packages/world-backend` (small), `packages/ai-planning` (one system prompt)

## Summary

Players currently have no visible body — only their creations are visible. This adds third-person voxel avatars: every player spawns instantly as a default chunky voxel character, walks/jumps with WASD + Space, collides with world objects (and can stand on them), and can re-create their body anytime via the existing prompt → Gemini → compile pipeline ("make me a red robot with a crown"). Avatars are synced through SpacetimeDB using the **already existing** `move_player` reducer and `PlayerSession` position/yaw fields.

## Decisions made (with rationale)

| Decision | Choice | Rationale |
|---|---|---|
| Embodiment | Third-person follow camera; orbit camera becomes avatar-centered | Seeing your own prompt-created avatar is the point of the feature |
| Physics scope | Ground + gravity + capsule-vs-AABB collision with world objects; can stand on objects | Most gameplay value (platforms, stairs, towers) with no physics engine |
| Player-vs-player | Non-solid (pass-through) | Anti-griefing standard for social sandboxes; avoids latency rubber-banding |
| Avatar acquisition | Default body at join, prompt-edit anytime | Join stays instant and keyless (no Gemini key wall at onboarding) |
| Animation | Procedural whole-body gait (no rig) | Works on any AI-generated voxel shape; on-brand chunky feel |
| Implementation approach | Custom lightweight controller, all client-side; no physics engine dep | Box-level collision is sufficient (see physics scope); zero new deps |

Explicitly **out of scope**: player-vs-player solidity, slopes/step-up assist, emotes, first-person mode, projectiles/combat, mobile/touch controls, separate avatar accessories. (Throwing/projectile games remain feasible later on this substrate: server-authoritative positions + the collision registry are the needed primitives.)

## Architecture

```
keyboard input ──▶ CharacterController (local: walk/jump/collide)
                      │ throttled ≤10 Hz, only-on-change
                      ▼
                  move_player reducer (EXISTS) ──▶ PlayerSession (position/yaw, EXISTS)
                      │ subscription via createBackendPresenceBridge (EXISTS)
                      ▼
                  RemoteAvatars (interpolated) ─┐
                  LocalAvatar (predicted)       ├─▶ <Avatar> renderer + procedural gait
set_avatar_spec (NEW) ──▶ player_avatar (NEW) ─┘
```

## 1. Backend (`packages/world-backend`)

### New table `player_avatar`

```
identity        t.identity().primaryKey()
voxelCoreJson   t.string()
builderSpecJson t.string()
version         t.u32()
updatedAt       t.timestamp()
```

Public table, separate from `PlayerSession` so the heavy spec JSON is not re-sent with 10 Hz position row updates, and so the body persists across sessions (anonymous identity persists in localStorage).

### New reducer `set_avatar_spec(voxelCoreJson, builderSpecJson)`

Upserts the caller's row. Server-side validation:
- both JSON strings parse;
- compiled bounds fit the avatar clamp (≤ 2 × 3 × 2 units pre-normalization);
- rate limit: reject if last update < 10 s ago (avatar editing must not become a spam channel).

`move_player` is unchanged. Follow the existing reducer/test patterns in `packages/world-backend/src/index.ts` and its tests.

## 2. Character controller + camera (`packages/3dvibegame-web/src/scene/`)

New `CharacterController` component inside the Canvas:

- **State** in refs (position, velocity, yaw, grounded), advanced in `useFrame`. No React state per frame.
- **Input**: held-key set (keydown/keyup) instead of the current per-keypress steps. WASD = camera-relative ground movement (reuse the direction math in `GameCanvas.tsx`'s `KeyboardController`); Space = jump (gravity ≈ −22 u/s², jump height ≈ 1.2 u). Walk speed ≈ 4 u/s.
- **Camera**: keep `OrbitControls` but drive its `target` to the avatar's head every frame — mouse-drag orbits around the avatar, damping and scroll zoom preserved. Camera does not need its own collision in V1.
- **Mode interaction preserved**: when a world object is selected, WASD moves the object (existing behavior) and the avatar stands still; Q/E remain object-only; the existing INPUT/TEXTAREA focus guard stays.
- Spawn near origin with a small random offset. If `y < −10`, respawn at origin.

## 3. Collision

- Module-level `CollisionRegistry` (plain map, no React): each rendered world object registers its world-space `THREE.Box3` (from `Box3.setFromObject`, recomputed on move/scale/version change), unregisters on unmount/archive.
- Controller per frame: swept-axis resolution — move X, resolve; move Z, resolve; move Y, resolve and set `grounded` when landing on a box top or the `y=0` infinite floor. Player capsule approximated as an AABB (≈ 0.6 × 1.8 × 0.6) is acceptable.
- Walking into a wall slides along it; standing on objects works.
- Other players are non-solid.

## 4. Avatar rendering + procedural gait

- `<Avatar>` renders a builder spec via the same voxel mesh path `AuthorityObject` uses; normalize so feet sit at group origin and height ≈ 1.8 u regardless of generated size.
- **Default body** when no `player_avatar` row exists: hardcoded chunky character builder spec, tinted with a hue derived from the identity hash.
- **Gait** (procedural, one `useFrame`, applied to the group transform, identical for local/remote):
  - phase accumulates with distance, not time: `phase += horizontalSpeed * dt * k` — bobbing stops exactly when movement stops (anti-foot-sliding);
  - Y-bob `sin(2·phase) · 0.05`; lateral tilt `sin(phase) · 4°` pivoted at the base; forward lean ∝ speed;
  - landing squash (scaleY 0.85 → 1 over ~150 ms); idle breathe (slow tiny Y-scale sine).
- Nameplate: drei `<Billboard>` + `<Text>` above the head showing the existing nickname.

## 5. Networking

- **Outbound**: call `move_player` at most every 100 ms AND only when moved > 1 cm or rotated > 2°. Idle players send nothing.
- **Inbound**: `createBackendPresenceBridge` already exposes per-player transforms (`BackendPlayerPresence`). Remote avatars lerp toward the latest transform (~150 ms smoothing, shortest-arc yaw); remote gait derives from interpolated velocity — remote players walk, not glide, with no protocol changes.
- Local avatar renders from local prediction only; never snapped to server echo.
- Subscribe to `player_avatar` alongside existing tables; swap bodies in place on update (reuse the spawn squash-pop feedback).

## 6. Avatar creation & edit flow

- "Edit avatar" entry point: button on your own row in `PlayerList` (and/or small HUD button) switches the prompt box into **avatar mode** (visible badge, Esc exits) — same pattern as the existing selected-object edit mode.
- New `avatarSystemPrompt` in `@3dvibegame/ai-planning`, modeled on `voxelEditSystemPrompt`, with constraints: a single standing character/creature on the ground plane, fits 2×3×2, `quantity` always 1.
- First-ever prompt generates from scratch; later prompts feed the current voxel core + change request (exactly like object edit in `createBackendLifecycleCommands.editSelectedObject`).
- Result → worker `/compile` (or local compile fallback) → `set_avatar_spec`. No locks, grace, cooldown, or object lifecycle involvement.

## 7. Error handling

- Generation/compile failure → keep current body, surface via the existing `FeedbackCard` error path. Never bodiless.
- Stored spec fails to parse client-side → render default body.
- Oversized/malformed spec from a hostile client → rejected server-side by `set_avatar_spec`.

## 8. Testing

- Unit (vitest, existing patterns): collision resolution (`resolveCapsuleVsBoxes`), gait math (phase stops at zero speed), outbound throttle gate, avatar spec validation/clamp.
- Component: avatar-mode prompt flow (like `PromptInput.test.tsx`), PlayerList edit-avatar button.
- Backend: `set_avatar_spec` reducer tests (upsert, size rejection, rate limit), following existing reducer test patterns.
- Manual smoke: two browsers — walk/jump around each other, edit avatar mid-session, other browser sees the new body and a walking (not gliding) remote avatar.
