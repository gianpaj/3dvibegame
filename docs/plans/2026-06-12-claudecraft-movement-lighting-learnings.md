# Claudecraft learnings: shadow follow, smooth turning, UTC sun/moon

Date: 2026-06-12
Source studied: `~/tmp/world-of-claudecraft` (Three.js MMO prototype)
Target: `packages/3dvibegame-web`

## What claudecraft does that we want

1. **One canonical sun, shadow frustum follows the player.**
   `SUN_ANCHOR` (`src/render/gfx.ts:100`) is a single sun direction shared by the
   shadow light, sky glow, god rays and water glints. Every frame the renderer
   re-anchors the shadow camera on the player
   (`renderer.ts:884-890`): `sun.position = playerPos + SUN_ANCHOR;
   sun.target.position = playerPos`. A tight ortho box + PCFSoftShadowMap +
   `bias -0.0006`, `normalBias 0.05`, `radius 4` keeps shadows crisp anywhere
   in the world.

2. **Facing-based movement, not input-vector movement.**
   The sim stores a `facing` angle; keyboard turning rotates it at a fixed
   `TURN_SPEED = π rad/s`, and forward motion integrates along the *current*
   facing (`sim.ts:580-628`). Because facing turns at a finite rate while
   position integrates along it, the path **curves** instead of snapping.
   Rendering interpolates `prevFacing → facing` with a shortest-angle lerp
   (`renderer.ts:742`), and the camera settles behind the character with an
   exponential ease `1 - exp(-dt * 3)` (`main.ts:200-212`).

3. **Sky**: HDRI dome rides the camera; sun disc sprites are placed at
   `cameraPos + sunDir * farDist` each frame. Claudecraft's sun is *static*
   (HDRIs are baked around it) — the UTC cycle below is our own feature, but it
   keeps the "one sun direction everything reads" principle.

## Current state of 3dvibegame-web (before this work)

- `scene/GameCanvas.tsx`: fixed directional light at `[10,15,5]`, shadow box
  ±20u **centered on the world origin** — walk away from spawn and your shadow
  degrades/vanishes. Avatar meshes already `castShadow`
  (`viewer/objects/createAuthorityObject.ts:126`), floor receives.
- `scene/avatar/CharacterController.tsx:144`: `yaw = atan2(move.x, move.z)` —
  instant snap; velocity is the raw camera-relative input vector.
- No time-of-day: static sky color, fog, two fixed lights.

## Implementation plan (in order)

### Step 1 — Shadow frustum follows the player (small)

- `CharacterController` exposes its live position via a shared
  `RefObject<THREE.Vector3>` lifted through `AvatarLayer` to `GameCanvas`.
- Replace the inline `<directionalLight castShadow>` with a `SunLight`
  component holding a light ref; add `light.target` to the scene; in
  `useFrame` set `light.position = avatarPos + sunOffset`,
  `light.target.position = avatarPos`.
- Shrink the shadow box to ~±15u around the player; keep
  PCFSoftShadowMap, add `normalBias` per claudecraft tuning.
- Viewer-only sessions (no avatar) keep the origin-anchored behavior
  (ref stays at 0,0,0).

### Step 2 — Smooth turn / curved movement (small)

In `CharacterController.useFrame`:

- Keep computing `targetYaw = atan2(move.x, move.z)` from camera-relative
  input, but ease: `yaw += shortestAngle(yaw, targetYaw) * (1 - exp(-dt * k))`,
  k ≈ 10.
- Integrate velocity along the **current** yaw (`sin(yaw), cos(yaw)`) instead
  of the input vector, so the avatar carves a curve while the body rotates.
- Add a `shortestAngle` helper (module `scene/avatar/angles.ts`, unit-tested);
  use it for remote-avatar yaw interpolation too so remote bodies never spin
  the long way around.

### Step 3 — UTC-driven sun + moon (medium)

- `scene/sky/sunPosition.ts`: **pure** `skyStateAtUtc(date)` mapping UTC
  time-of-day to sun/moon direction + elevation (simple circular path:
  `elevation = sin((h - 6) / 24 · 2π)`, azimuth sweeping east→west). Unit
  tests in `sunPosition.test.ts` (noon up, midnight down, sunrise ≈ 06:00 UTC).
- `scene/sky/DayNightCycle.tsx` replaces the static lights in `GameCanvas`,
  owning:
  - **Sun** directional light (absorbs Step 1's follow logic): warm color,
    intensity ramped by `smoothstep` on elevation through twilight.
  - **Moon** directional light: dim blue (~`#9db4ff`), becomes the **only**
    `castShadow` light when the sun sets — never two shadow maps at once.
  - Hemisphere light, background `<color>`, and fog lerped between
    day/dusk/night palettes with `1 - exp(-dt·k)` smoothing.
  - Stars (drei `<Stars>`) faded in at night; sun/moon disc sprites at
    `cameraPos + dir · farDist`.
  - Celestial angles recomputed ~once per second; player-follow every frame.
- Dev override: `?timeOfDay=18.5` query param to pin the clock for testing.

## Non-goals

- Real solar ephemeris / latitude-accurate sun paths.
- Shadow LOD tiers (articulated vs proxy casters) — our scenes are small.
- HDRI sky domes.
