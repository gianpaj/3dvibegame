# 3dvibegame-web — Agent Notes

React + React Three Fiber player app. Connects to the SpacetimeDB backend for multiplayer and calls Gemini directly from the browser for AI object generation.

---

## Dev

```bash
pnpm dev          # Vite dev server (http://localhost:5173)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (all unit + integration tests)
pnpm test:watch   # vitest watch
pnpm build        # typecheck + Vite production build
```

### Environment (copy `.env.local` from `.env`)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SPACETIMEDB_URI` | No | SpacetimeDB server URL. Omit for local-only mode. |
| `VITE_SPACETIMEDB_DATABASE` | No | Module name, e.g. `3dvibegame`. |
| `VITE_AI_CLIENT_MODE` | Yes | `browser-gemini` (default) or `http-worker` |
| `VITE_AI_WORKER_URL` | No | `/compile` worker URL; enables server-side compile. |
| `VITE_BROWSER_GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash`. |

Without `VITE_SPACETIMEDB_URI` / `VITE_SPACETIMEDB_DATABASE` the app runs in local single-player mode (no backend, no persistence).

---

## Testing

Tests live in `src/**/*.test.ts(x)` and `src/integration/`. Run with `pnpm test`.

- **Unit tests**: component logic, AI worker client, chat transcript hook.
- **Integration test** (`src/integration/multiuser-lifecycle.test.ts`): full authority lifecycle (create → move → edit) using mocked Gemini responses from `src/test/fakeGemini.ts`. No network, no SpacetimeDB key needed.
- **Backend smoke tests**: live against a running SpacetimeDB instance — see `packages/world-backend/scripts/` and run via `pnpm smoke:*` in that package.

When adding a new reducer field or changing the AI pipeline, check if `multiuser-lifecycle.test.ts` needs updating. It tests `@3dvibegame/scene-authority-ts` reducers directly, not the SpacetimeDB backend or network path.

---

## Deployment (Cloudflare Pages)

Deployed automatically via Cloudflare Pages' native GitHub integration — no GitHub Actions. Pushes to `master` trigger a build and deploy to <https://3dvibegame.com>.

`VITE_*` vars are baked at build time. Set them in the Cloudflare Pages project → Settings → Environment variables:

```
VITE_SPACETIMEDB_URI=https://stdb.3dvibegame.com
VITE_SPACETIMEDB_DATABASE=3dvibegame
VITE_AI_CLIENT_MODE=browser-gemini
# Optional: VITE_AI_WORKER_URL=https://ai.3dvibegame.com
```

Manual deploy (e.g. to test a branch):

```bash
CLOUDFLARE_ACCOUNT_ID=f993cefa62ff85589a32173f0813fbad \
  wrangler pages deploy dist --project-name 3dvibegame --branch master
```

---

## Backend Schema Changes

The SpacetimeDB module bindings in `src/backend/module_bindings/` are **auto-generated** but committed to the repo. After changing a reducer in `packages/world-backend/src/index.ts`:

1. Manually update the matching `*_reducer.ts` file in `module_bindings/` to match the new schema.
2. Update the TypeScript interface in `createBackendPresenceBridge.ts` (e.g. `BackendSubmitAiDraftInput`).
3. Republish the backend: `spacetime publish --server https://stdb.3dvibegame.com --yes 3dvibegame`
4. Run `pnpm typecheck` to confirm everything aligns.

The canonical re-generation command is `spacetime generate --lang typescript` — run it when the backend is republished to a local server to get a fresh set of bindings, then commit.

---

## Key Architecture Decisions

**AI client modes**

| Mode | `VITE_AI_CLIENT_MODE` | Who calls Gemini | Who compiles |
|---|---|---|---|
| Browser Gemini (default) | `browser-gemini` | Browser (user provides API key) | Browser |
| Browser + worker compile | `browser-gemini` + `VITE_AI_WORKER_URL` | Browser | AI worker (`/compile`) |
| HTTP worker | `http-worker` | AI worker (`/generate`) | AI worker |

**Multi-object creation**

When the AI returns `quantity > 1` (e.g. "create 2 palm trees"), `submitPrompt` in `createBackendLifecycleCommands.ts`:
- Calls the AI **once** to get a single-object spec
- Submits N backend jobs, each with a 2.5-unit X offset
- **Releases all but the first immediately** — the first stays in grace so the player can position it; the rest become public objects the player can click-select to move individually

**Color rendering**

`color_hint` on a `VoxelMaterial` is the authoritative color. The voxel compiler (`scene-authority-ts`) maps `material_id → color_hint` before building `BuilderPart`s. The renderer (`createAuthorityObject.ts → resolveMaterialColor`) handles color names (`"yellow"`, `"blue"`, etc.) and hex strings (`"#rrggbb"`). Named materials like `"jelly"` or `"void"` have hardcoded colors used when no `color_hint` is present.

**Spawn position**

New objects spawn at the point where the camera's look ray intersects `y=0` (capped at 20 units). This is computed inside the R3F canvas via `SpawnPointRegistrar` and threaded through `GameCanvas → App → createBackendLifecycleCommands` via a `spawnPointRef`.

**Token recovery**

If the SpacetimeDB server is reset and returns "Failed to verify token", `onConnectError` in `createBackendPresenceBridge.ts` clears the stale localStorage token and reloads the page so the user gets a fresh identity.
