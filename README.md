# 3d vibe game

- <https://3dvibegame.com>

Current vertical slice:
`text prompt → browser Gemini → voxel ops + quantity → worker compile → object(s) spawned in front of camera → select + AI-edit / move / delete`

https://github.com/user-attachments/assets/17322171-449d-4279-a8c7-0218190edb77

## Player app

**`packages/3dvibegame-web`** — React + React Three Fiber, deployed on Vercel.

- Deployed on Cloudflare Pages via native GitHub integration (`master` auto-deploys)
- Real-time multiplayer via SpacetimeDB (`stdb.3dvibegame.com`)
- Prompt to create: browser calls Gemini (BYOK) → voxel operations → AI worker `/compile` (or local compile as fallback)
- Multi-object prompts ("create 2 palm trees"): AI returns `quantity`, client spawns N objects with offset positions — first stays in grace for placement, extras auto-release to public
- Select an object → AI-edit via chat ("make it red"), or WASD / rotate / scale / delete under exclusive 30s edit locks
- Objects spawn at the camera look-ray intersection with `y=0`
- Color rendered from `color_hint` on each material (e.g. `material_id: "jelly", color_hint: "yellow"` → yellow, not pink)

**`packages/scene-runtime-demo`** — original plain Three.js dev harness for fixtures and HUD testing (not the deployed app).

## Architecture

```
player prompt
  → browser Gemini (BYOK)         → VoxelCore JSON (quantity, materials, operations)
  → AI worker /compile            → VoxelBuilderSpec + BuilderSpec
  → submit_ai_draft reducer       → world object in grace state (SpacetimeDB)
  → release_object / edit_lock    → public / edit_locked / cooldown / archived
```

Shared packages:
- `@3dvibegame/scene-authority-ts` — pure reducers, voxel compiler, contracts (authority truth)
- `@3dvibegame/ai-planning` — Gemini system prompts, voxel schema (`VoxelCore` incl. `quantity`), `buildVoxelResponse`

## Workspace packages

| Package | Purpose |
|---|---|
| `packages/3dvibegame-web` | Deployable player app (React + R3F, multiplayer) |
| `packages/world-backend` | SpacetimeDB module (worlds, presence, object lifecycle, locks) |
| `packages/ai-worker` | Cloudflare Worker — keyless `POST /compile`, keyed `POST /generate` |
| `packages/scene-authority-ts` | Authoritative reducers, contracts, voxel→builder compiler |
| `packages/ai-planning` | Gemini schemas, system prompts, `buildVoxelResponse` |
| `packages/scene-runtime-demo` | Plain Three.js dev harness (not the deployed app) |
| `packages/scene-runtime-ts` | TypeScript port of planning/render contracts |
| `packages/website` | Placeholder marketing site |

## Commands

```bash
# Player app
pnpm web:dev        # Vite dev server (localhost:5173)
pnpm web:build      # typecheck + Vite production build
pnpm web:test       # vitest run

# Dev harness
pnpm demo:dev
pnpm demo:build

# Backend smokes + typecheck
pnpm phase3:smoke
pnpm typecheck
```

Player app env vars — copy `packages/3dvibegame-web/.env` to `.env.local` and fill in:

```
VITE_SPACETIMEDB_URI=https://stdb.3dvibegame.com
VITE_SPACETIMEDB_DATABASE=3dvibegame
VITE_AI_CLIENT_MODE=browser-gemini
# VITE_AI_WORKER_URL=https://ai.3dvibegame.com   # optional server-side compile
```

The Gemini key is entered in-app at runtime — never an env var.

## Deploy

### Player app → Cloudflare Pages

Deployed automatically via Cloudflare Pages' native GitHub integration — no GitHub Actions involved. Pushes to `master` trigger a build and deploy.

`VITE_*` values are baked at build time. Set them in the Cloudflare Pages project settings → Environment variables, then redeploy:

```
VITE_SPACETIMEDB_URI=https://stdb.3dvibegame.com
VITE_SPACETIMEDB_DATABASE=3dvibegame
VITE_AI_CLIENT_MODE=browser-gemini
# VITE_AI_WORKER_URL=https://ai.3dvibegame.com   # optional
```

Manual deploy (e.g. to test a branch):

```bash
CLOUDFLARE_ACCOUNT_ID=f993cefa62ff85589a32173f0813fbad \
  wrangler pages deploy packages/3dvibegame-web/dist \
  --project-name 3dvibegame --branch master
```

### Backend (SpacetimeDB + AI worker) → Coolify VPS

See [`docs/deploy-backend.md`](docs/deploy-backend.md).  
Compose: `deploy/spacetimedb/docker-compose.yml` · AI worker Dockerfile: `packages/ai-worker/Dockerfile`

```bash
# Publish world-backend module
cd packages/world-backend
spacetime logout
spacetime login --server-issued-login https://stdb.3dvibegame.com
spacetime publish --server https://stdb.3dvibegame.com --yes 3dvibegame
```

Useful URLs:

- Production: <https://3dvibegame.com>
- Cloudflare Pages dashboard: <https://dash.cloudflare.com/f993cefa62ff85589a32173f0813fbad/pages/view/3dvibegame>
