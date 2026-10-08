# Visual-quality evaluation — implementation notes

Working notes for `docs/plans/2026-10-08-visual-quality-evaluation.md`.

## Findings from the codebase (2026-10-08)

- `object_feedback.source_spec_json` is the **parsed `VoxelBuilderSpec`**
  (`parseVoxelBuilderSpec` strips unknown keys), not the raw Gemini `VoxelCore`.
  `quantity` lives only on the core, so a feedback row can never prove
  single-object scope by itself. Imports mark quantity as unknown, and a human
  must add `quantity: 1` to the manifest.
- `BuilderSpec` had no runtime schema (the web client just casts). A structural
  zod schema now lives in `scene-authority-ts/src/builder-guards.ts`.
- `instances.length > 1` is legitimate for a single object: `clone_region`
  layouts compile into one part set with N instances (e.g. barrel triangle).
  Only `quantity > 1` means multiple world objects.
- Game renderer: ACES filmic tone mapping, sRGB output, PCF soft shadows
  (`GameCanvas.tsx`). The capture page uses the same settings.
- `createAuthorityObject` adds rings only for non-public states and for
  `selected`. Capture renders `state: "public"`, `selected: false`.

## Decisions API (checked 2026-10-08)

- Guide: https://developers.openai.com/api/docs/guides/decisions.md (public
  beta; `gpt-6-luna` is the only model). Not yet listed in the endpoint
  reference; response types were read from `openai@7.30.1`
  `resources/decisions.d.ts`.
- Response: `{ answers[], model, usage{input_tokens, output_tokens, total_tokens, ...} }`.
  Answer types: `predicate | choice | score | refusal`. A refusal has only
  `name` + `type`.
- Score answer: `score` (probability-weighted index), `confidence`,
  `probabilities[{value, label, probability}]`.
- Images must be inline data URLs, max 128 per request, optional `detail`.
- Price: $0.10 / 1M input tokens, no output charge. The image token count for
  luna isn't documented; the budget uses a configurable per-image estimate.

## Design choices

- The harness is a workspace package at `scripts/visual-quality` (added to
  `pnpm-workspace.yaml`) so it gets its own deps (zod, playwright, vite) and
  vitest.
- The capture page lives in `packages/3dvibegame-web/visual-quality/` with its
  own vite config. It's built to `.tmp/visual-quality/capture-app/` and served
  by a tiny static server. A static build avoids dev-server dep re-optimisation
  reloads and gives a content hash to use as the "renderer revision".
- Software GL (SwiftShader) in headless Chromium, so repeated captures are
  stable on one machine and don't depend on the GPU.
- The Decisions client uses raw `fetch` (no SDK dependency) so the mock client
  and request hashing see the exact wire format.
