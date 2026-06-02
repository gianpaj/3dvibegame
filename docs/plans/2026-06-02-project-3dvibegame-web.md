---
name: project-3dvibegame-web
description: New MVP public-facing web app package (packages/3dvibegame-web) built with React + React Three Fiber
metadata:
  type: project
---

`packages/3dvibegame-web` is the MVP deployable player app, separate from `packages/scene-runtime-demo` (the dev harness).

**Why:** Needed a clean, deployable version for public players; scene-runtime-demo has too much debug surface area.

**Stack:** React 19 + R3F v9 + Three.js r180 + Vite. SpacetimeDB included (multiplayer retained). Gemini key always user-provided via modal.

**Key design decisions:**
- R3F `<Canvas>` replaces the entire imperative viewer pipeline (renderer, scene, camera, loop)
- `<AuthorityObject>` uses `<primitive object={threeJsGroup}>` to mount existing Three.js groups from `createAuthorityObject`
- Backend is dynamically imported (`import("./backend")`) to avoid loading SpacetimeDB when not configured
- Gemini API key stored in `sessionStorage` only

**Scripts:** `pnpm web:dev`, `pnpm web:build` (added to root package.json)

**Deployment:** `vercel.json` with SPA rewrite rule at `packages/3dvibegame-web/vercel.json`. Deploy with `vercel --cwd packages/3dvibegame-web`.

**How to apply:** When adding features to the public app, work in `packages/3dvibegame-web`. When working on dev/debug features, work in `packages/scene-runtime-demo`.
