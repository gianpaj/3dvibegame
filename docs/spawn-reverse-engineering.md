# Spawn.co — Reverse Engineering Findings

> Source: https://www.spawn.co | https://www.spawn.co/llms.txt
> Analysed: 2026-04-02

---

## What It Is

Spawn is a browser-based, AI-native multiplayer game creation platform. The core pitch: **creation is the gameplay**. Users describe things in natural language, an AI companion named Savi generates them in real-time (30s–2min), and the world updates live for everyone in the session.

Launched February 2026. Team <10. Founded by Jacob Sansbury (prev. exit to Robinhood).

---

## UX / Creation Flow

1. Create a new game → land in a flat grassy world
2. Hold **Tab** to summon Savi (AI companion)
3. Describe what you want in plain English
4. Assets appear in real-time — no separate build or publish step
5. Share a link → friends join the live world immediately
6. Multiplayer by default; creators and players coexist

Savi uses 10,000–32,000 thinking tokens per response from frontier LLM models.

---

## Engine Architecture

### Declarative World Spec
A world is a declarative spec over six top-level domains:
```
terrain | inputs | objects | player | camera | UI
```
Savi manipulates these via tool calls. The engine interprets changes into live ECS state — no code generation, no build steps.

### ECS (Entity Component System)

- Archetype-based storage with three backend configurations:
  - Standard arrays (general components)
  - SoA for `Vec3` components
  - SoA for `Vec4` components
- Component replication policies: `aoi` | `owner` | `always` | `never`
- Scheduler with `before`/`after` dependency ordering and cadence-based execution

### Networking Protocol

- **60 Hz server-authoritative tick rate** (16.67ms ticks)
- **Binary wire protocol** with two channels:
  - *Control channel*: reliable delivery, ACK tracking, control messages and event components
  - *Snapshot channel*: unreliable delta-compressed state snapshots, 5-frame redundancy
- Delta compression: field-level tracking — unchanged state = zero bandwidth
- Initial sync via `fullsync`, steady-state via delta frames
- **Area-of-Interest (AOI)**: radius- or grid-based entity filtering per place; grace periods prevent oscillation at AOI boundaries
- **Dynamic tick rate throttling**: server adjusts per-client rate 0.8×–1.1× to target 3 buffered frames; 30-tick healthy streak triggers reduction

### Physics

- Deterministic WASM physics engine
- Server-authoritative with client-side prediction + rollback up to **45 ticks**
- Ring-buffer oplog tracks mutations; on server/client mismatch → rollback + re-simulate
- Supports: character controllers, rigid bodies, colliders, sensors, raycasts (with group masks)
- One physics world per *place* (lazy-created on first physics entity)
- Entity transfers between places: dispose from old physics world, recreate in new

### Server Runtime

- WebSocket-based, per-room ECS world instances
- Runtime loop: `preUpdate → input → simulation → postUpdate → replication`
- Job queue: worker thread pool scaled to CPU count; priority levels `low/normal/high`, deduplication, deadline tracking
- Room heartbeat every 30s; stale cleanup after 90s (3 missed heartbeats)

### Backends / Infrastructure

- Supabase: `ljbqupviqnmmxwmrkxiy.supabase.co` (auth + data)
- Game servers: `prod.bigspawn.net`
- File storage: `spawnfile.io`

---

## WebSocket Protocol (Observed Messages)

There are at least two separate WebSocket connections: one for the **AI studio** (Savi chat + turn management) and the binary game simulation channel described above. The messages below are from the studio channel, which is JSON over WebSocket.

### `room_snapshot` — initial message on connect

Sent by the server immediately on room join. Contains the full AI conversation state.

```jsonc
{
  "type": "room_snapshot",
  "state": {
    "schemaVersion": 1,
    "seq": 4,                          // monotonic sequence number
    "updatedAt": 1775201188548,        // ms timestamp
    "appId": "196d76d5-...",           // game UUID
    "aiConfigured": true,
    "commands": [                      // slash commands available in the chat UI
      { "name": "compact",  "description": "Trigger chat history compaction", "requiresArgs": false, "source": "builtin" },
      { "name": "focus",    "description": "Recenter the game around its core fantasy before more building", "requiresArgs": false, "source": "builtin" },
      { "name": "debug",    "description": "Take a careful bug pass, then fix the best issue", "requiresArgs": false, "source": "builtin" }
    ],
    "queue": [],                       // pending AI tasks
    "turns": {                         // keyed by "history-{uuid}" or "active-{uuid}"
      "history-{uuid}": {
        "id": "history-{uuid}",
        "queueStatus": "done",         // done | queued | processing
        "status": "complete",          // complete | error | cancelled
        "user": null,                  // null for history; populated for active turns
        "assistant": {
          "messageId": "{uuid}",
          "text": "Pink tree coming up...",
          "thinkingTokenCount": 0,     // extended thinking token count
          "thinkingText": null,        // visible only when ultrathink=true
          "statusMessage": null,       // in-progress status shown in UI
          "ultrathink": false,         // premium deep-thinking mode flag
          "tools": [],                 // tool calls made during this turn
          "errorMessage": null
        },
        "presentation": { "assistantVisibleAfter": null },
        "queuedAt": 1775135455151,
        "startedAt": 1775135426780,
        "firstTokenAt": 1775135432770, // TTFT: ~6s here
        "completedAt": 1775135455151,
        "updatedAt": 1775201187897
      }
    },
    "turnOrder": ["history-{uuid}"],   // ordered list of turn IDs
    "activeTurnId": null,              // null when idle
    "lastCompletedTurnId": "history-{uuid}",
    "followup": null,
    "compaction": { "active": false, "startedAt": null },
    "tokenUsage": {
      "current": 41330,
      "threshold": 120000              // compaction triggered at threshold
    },
    "wispActivities": []               // active background agents
  },
  "serverNow": 1775201188963           // server clock for client drift correction
}
```

**Key observations:**
- Turn IDs are prefixed: `history-` for past turns (implies `active-` for in-flight turns)
- `ultrathink` flag per turn — likely maps to the "genius" wisp tier (deep thinking + extended output)
- `tokenUsage.threshold: 120000` — compaction (`/compact`) fires before context window is exhausted; current was at ~34% (41K/120K)
- `firstTokenAt` allows computing TTFT per turn; the example shows ~6s to first token
- `tools: []` on the assistant turn — production turns would list every tool call Savi made

---

### `studio_user_message` — sent on user message submit

Sent client → server when the user submits a prompt.

```jsonc
{
  "type": "studio_user_message",
  "messages": [
    {
      "role": "user",
      "content": "<user text> <<Game state: ...>> <<User context: ...>> <<Community pitch: ...>>"
    }
  ],
  "clientMessageId": "4d7e4f82-...",   // idempotency key
  "screenshot": "data:image/jpeg;base64,...",  // current game view; sent with EVERY message
  "clientRole": "admin"                // admin (creator) vs player
}
```

**Context injection blocks** — the client assembles the full prompt by appending `<<...>>` blocks to the raw user text:

| Block | Contents |
|---|---|
| `<<Game state>>` | Place name, spec revision, player XYZ position, look direction (XYZ + yaw/pitch), timestamp |
| `<<User context>>` | Game name, username, location, local time, follow tags, **OUTPUT FORMAT REMINDER** |
| `<<Community pitch>>` | Injected Discord invite instructions with specific wording rules and link |

**Key observations:**
- **The AI is multimodal** — a JPEG screenshot of the current game view is sent with every single message, giving Savi visual context
- **System prompt is assembled client-side** at send time, not stored server-side; the `<<...>>` injection pattern is transparent in the wire format
- `OUTPUT FORMAT REMINDER` is part of `<<User context>>`: *"You MUST NOT write any text between tool calls. One short text at start, tools, one short text at end. Do not list what you will build. Do not announce steps. Do not narrate. All planning goes in your thinking block, not in visible text."* — this is the constraint that keeps Savi's responses concise
- `clientRole: "admin"` — the server enforces different tool permissions for creators vs players (players presumably cannot call terrain-modification tools)
- The Discord community invite is **always injected** server-side into every message — it's a growth mechanic baked into the prompt pipeline

---

## Asset Generation Pipeline

Everything generates from natural language descriptions.

| Asset type | Output format | Details |
|---|---|---|
| 3D props | GLB (2K textures) | Static mesh |
| 3D characters | GLB (2K textures) | Rigged + idle/walk/run animations |
| Images | PNG / transparent PNG / pixel art | Textures, sprites, skyboxes, UI |
| Music | Audio file | Mood/style/length/instrumental controls |
| SFX | Audio file | Duration/loop support |
| Voice | Audio file | Custom voice from text description; persistent across generations |

### Automatic 3D Post-Processing (every model)

1. Scale-to-height normalization (target height in meters)
2. Geometry simplification — vertex dedup + normal recalculation → **20–40% file size reduction**
3. AVIF texture compression with atlasing + mipmap generation
4. **4-level LOD generation**: LOD1=50%, LOD2=25%, LOD3=3.75%, LOD4=0.56% of original
5. Convex decomposition colliders by size class: tiny=2 hulls, small=4, medium=8, large=16
6. **Impostor rendering**: baked billboards (albedo + normal + depth) for extreme distances

LOD and collider generation run in parallel.

---

## Behavior Scripting

Scripts run in a sandboxed environment. Lifecycle hooks available:

```
onSpawn | update | onInput | onInteract | onCollide
onTriggerEnter | onTriggerExit | onControlBegin | onControlEnd
onLiquidEnter | onLiquidExit
```

Scripts use `require()` for builtins/libraries and export named hook functions.

### LLM Jobs From Scripts

Three job types callable from behavior scripts:

| Job | Purpose |
|---|---|
| `llm:chat` | Free-form text (dialogue, narration); persistent `conversationId` memory |
| `llm:generate` | Structured JSON with schema enforcement (quests, dialog trees, validations) |
| `llm:clear` | Reset conversation memory |

Use cases: persistent NPC memory, riddle gates, procedural quest gen, AI dungeon master.

---

## Game Feel API ("Juice")

**52 methods across 13 categories:**

| Category | Methods |
|---|---|
| Object | highlight, flash, shake, dissolve, fade, trail, squash, moveTo |
| Camera | screenShake, cameraPunch, hitstop, zoomTo, letterbox |
| Screen | screenFlash, vignette, effect, clearEffect, slowMo |
| Particles | particleBurst, stopParticleBurst, propBurst |
| UI | interactPrompt, damageNumber, toast, announce |
| Audio | playSound, stopSound, musicShift, ambience |
| Timing | runSchedule, cancelSchedule |
| Mood | defineMood, setMood, defineWeather, weather, timeOfDay |
| Data Registry | define, get, all, filter, pick |
| Encounters | spawnWave |
| Narrative | dialog, choice |
| Progress | mark, marked, getPlayer, getProgress |
| Economy | grant, spend, has, getBalance |

Audience routing: `self` | `nearby` | `all`. Events replicate via dedicated juice components with per-player state tracking.

---

## Audio System

Spatial 3D with **5 buses**: Master, Music, SFX, UI, Ambience, Voice.

- HRTF panning for spatial positioning
- Doppler velocity support
- Voice stealing + distance-penalty-based automatic prioritization
- Reverb zones (spherical or box, wet/decay params)
- Audio component types:
  - `AudioIntent` — persistent spatial source (clip, gain, pitch, loop, rolloff)
  - `AudioOneShotEvent` — fire-and-forget with variation
  - `AudioListener` — marks the listener entity
  - `AudioReverbZone` — spatial reverb

---

## Terrain System

Heightmap-based with material blending. Terrain marks:
- **Rivers** — channel along points, width/depth/materials, water on top
- **Ponds** — depression with water, radius/depth
- **Oceans** — water zone (no carve), rectangle or half-plane

Chunks stream by player proximity. Per-place terrain definitions.

### Scatter System

- Automated object distribution; spawner owns child entities (cascade delete on removal)
- Bounds shapes: circle, rectangle, polygon, ring, path
- Sampling strategies: Poisson disk, grid, random, clustered, edge
- Weighted template selection with scale/rotation variation
- **500 children max per spawner**
- Auto-excludes terrain marks (no trees spawning inside rivers)

---

## Multi-Scene (Places)

Multiple places per game (dungeons, realms, dimensions), each with separate terrain, physics world, atmosphere, and entities.

- `api.enterPlace()` for server-authoritative entity transitions
- AOI scopes: place first, then distance
- Instance lifecycles: `ephemeral` | `session` | `persistent`
  - Persistent: snapshotted to storage, rehydrated on startup

---

## UI Overlay System

HTML overlays rendered atop the 3D world.

- UI spec defines buttons, menus, HUD elements
- Render functions: `(localPlayer, worldState) => HTMLString`
- **Morphdom** patches DOM incrementally (no full re-render)
- **Tailwind CSS** for styling
- `sendAction()` bridges click events back into behavior scripts
- One active UI at a time, icon-based switching in god mode toolbar

---

## AI Companion Architecture

### Savi

- Frontier LLM with direct tool access: create/update/remove objects, modify terrain, edit behavior scripts, check runtime logs
- 10,000–32,000 thinking tokens per response
- Pattern learning from TypeScript behavior examples + markdown skill files (loaded on-demand)
- Multi-provider fallback for reliability

### Wisps (Background Agents)

- Up to **5 concurrent** background AI agents
- Three tiers: `fast` (lightweight) | `smart` (high thinking) | `genius` (deep thinking + extended output)
- Use cases: asset generation, balance analysis, spec exploration

### Dungeon Master Mode

- Behavior scripts call `api.notifyDm(message)` to send events to Savi
- Savi reacts in real-time during gameplay — spawns encounters, shifts atmosphere, modifies the world

---

## Mods System

- Publishable mods with semantic versioning stored in DB with install counts
- Savi accesses mods via tool: search, install, remove, list, publish, update
- Installation merges mod operations into base spec with automatic namespacing
- Creator mods register UI panels in the god mode toolbar

Community mod examples: Cinemachine Toolkit, Slash FX Tool, Animation Browser, Prefab Painter.

---

## Frontend Stack

- **Next.js 14+** with React Server Components + RSC streaming
- **TailwindCSS** for styling
- **React Query** with dehydrated state; query key pattern: `["all-user-queries", "current-user"]`
- Segment for analytics
- Custom event system: `spawn:kernel:loading-state` tracks kernel init phases (`ready | error | disconnected`)
- Kernel loaded in iframe (`[data-spawn-kernel-frame="true"]`)
- Stall warning after 10s of non-ready state; stores last 40 trace events per pathname

---

## Relevance to 3dvibegame

Spawn is the closest publicly-shipped competitor. Key gaps where 3dvibegame can differentiate or learn:

| Spawn approach | 3dvibegame consideration |
|---|---|
| Monolithic Savi AI — one companion for everything | Explicit staged generation session (prompt → draft → grace edit → release) may give users more control |
| Always-online multiplayer | Single-player-first prototype is lower risk for validating generation quality |
| Proprietary WASM physics + custom ECS | Three.js + external physics lib is a viable shortcut for a prototype |
| 60 Hz server-auth tick rate | Not needed until multiplayer slice (TODO #5) |
| `llm:generate` for structured JSON from scripts | Matches 3dvibegame's validation-first generation session approach |
| Scatter system + terrain streaming | Scope-creep risk — validate object lifecycle before terrain |
| Juice API (52 methods) | Worth designing a minimal subset early; game feel matters for retention |
| Wisps (background AI agents) | Maps to the "AI worker reliability" benchmark (TODO #4) |
| Grace period + lock/cooldown on object edits | Directly maps to TODO #2 — grace period object lifecycle |
| Authoritative reducer with permissions | Directly maps to TODO #3 — authoritative reducer simulation |
