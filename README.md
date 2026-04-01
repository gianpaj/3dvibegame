# 3d vibe game

👷

- <https://3dvibegame.com>

```txt
LLM raw output -> parse/validate -> normalize scene plan -> render
```

## TODO slices

1. `normalized scene plan -> deterministic object builder`
   This is the biggest missing seam after the renderer. You need a benchmark that takes `ObjectIntent` and produces a constrained chunky object draft, then scores:
   - recognizability
   - size/material compliance
   - edit continuity between `create` and `refine`
   - determinism from the same input
2. `grace period object lifecycle` prototype
   Single-player is enough at first. Prove:
   - prompt creates draft
   - creator can move/scale/refine for N seconds
   - release flips object into public state
   - post-release edits obey lock and cooldown rules
3. `authoritative reducer simulation` benchmark
   This should be mostly tests, not a visual app. Feed reducer actions into a fake world and validate:
   - public vs private permissions
   - one-editor-at-a-time locking
   - inactivity timeout
   - cooldown enforcement
   - stale version rejection
4. `AI worker reliability` benchmark
   The current scene-planning bench proves schema quality. Add product metrics:
   - clarification rate
   - refusal rate
   - parse/validate success rate
   - latency p50/p95
   - cost per successful draft
   - quality by prompt class: create, refine, remix
5. `multiplayer room load` prototype
   Before real polish, prove the boring part:
   - 20 anonymous players
   - presence sync
   - object create/edit deltas
   - reconnect and late-join replay
   - no lock corruption under contention

### After that

- `archive/reset` wedge: snapshot live world, freeze it, reopen as read-only exploration.
- `remix safety` benchmark: classify and reject destructive edits in public worlds while allowing them in private worlds.
- `client delta replay` harness: apply authoritative event logs to a fresh client and verify final state matches.
- `prompt-to-feel` playtest slice: does rough draft + short grace period actually feel fun, or just awkward?

### Recommended order

1. Planning benchmark
2. Three renderer seam
3. Deterministic object builder
4. Grace-period lifecycle prototype
5. Reducer/permissions benchmark
6. Multiplayer load + replay harness
7. Archive/reset prototype
8. Playtest loop with real users

Maybe we need validation roadmap with repo-level packages, success metrics, and which ones should be benchmarks versus interactive prototypes.


## What we have

`scene-planning-bench` covers “planning benchmark + preview draft generation.”
It does not yet cover “builder benchmark.”

## Workspace packages

- `packages/website` — current placeholder marketing site
- `packages/scene-runtime-ts` — TypeScript consumer port of the Python `scene_runtime` contract
- `packages/scene-runtime-demo` — plain Three.js demo for inspecting runtime fixtures in the browser

## Demo commands

```bash
pnpm demo:dev
pnpm demo:build
pnpm typecheck
```

## Manual deploy

`packages/scene-runtime-demo` is deployed as a Cloudflare Pages project named `3dvibegame` in account `f993cefa62ff85589a32173f0813fbad`.

Build and deploy it manually from the repo root:

```bash
pnpm demo:build
CLOUDFLARE_ACCOUNT_ID=f993cefa62ff85589a32173f0813fbad \
  wrangler pages deploy packages/scene-runtime-demo/dist \
  --project-name 3dvibegame \
  --branch master
```

Useful URLs:

- production domain: <https://3dvibegame.com>
- Pages dashboard: <https://dash.cloudflare.com/f993cefa62ff85589a32173f0813fbad/pages/view/3dvibegame>

Notes:

- The old `3dvibegame` Worker in Cloudflare Workers is separate from the Pages project.
- As of 2026-04-01, the custom domain `3dvibegame.com` is attached in Cloudflare but still shows `pending`. If the custom domain is not serving yet, use `https://3dvibegame.pages.dev`.
