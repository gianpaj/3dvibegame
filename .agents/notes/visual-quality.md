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

## Capture (step 2) learnings

- Two independent fresh captures under SwiftShader (Chromium 156, Playwright
  1.64, three r180) were byte-identical on this machine (21/21 views). Tests
  still assert on stats (framing, foreground fraction, hue buckets) rather than
  bytes, so they hold on other machines.
- Fitting the camera to bounding-box corners framed sparse objects loosely
  (orbs filled about 50% of the frame). Fitting to world-space mesh vertices per
  view gives consistent fill.
- The compiler centres `add_box` on `position` (no grounding without
  `groundOperations`). The first flagpole fixture had a floating flag because of
  this; author fixture sources with centre positions.
- Background `#aab3bf`: the lighter `#c9ced6` made white parts blend in.
- A favicon 404 surfaces as a console error, which correctly fails a capture.
  The page sets `<link rel="icon" href="data:,">`.
- Capture of one sample takes about 0.4 s (about 1.1 s for the first, which
  includes shader warm-up).

## Gotchas

- The local pnpm (10.21.0 via corepack) drops `libc: [glibc|musl]` lines from
  `pnpm-lock.yaml` on install. They were written by a newer pnpm (dependabot).
  After any install, restore them so the lockfile diff only holds real changes.

## Judge (step 3) notes

- Rubric wording: the plan's level 2 for attribute fidelity says "a material
  discrepancy". In this game "material" also means a surface type, so the
  rubric says "a significant discrepancy" to keep the judge from reading it as
  texture.
- Prompt injection: the prompt is sent as a JSON string inside a labelled
  input_text part. It can't break out of its quoting, and the preamble tells the
  judge to treat it as data.
- Cost: luna charges $0.10/1M input tokens. With 3 × 768px images the dry-run
  estimate is about $0.0006 per request, so budget limits matter more as a
  runaway guard than for spend.
- The mock client is deterministic from a request hash. Its scores are
  meaningless; the mock flag is part of the reuse key and the record.
- No live call has been made yet. The request shape follows the guide and the
  `openai@7.30.1` types, and still needs an authorised smoke run.

## Status (2026-10-09)

- Steps 1–4 are implemented and tested. Step 5 (calibration pilot) has its
  tooling and a runbook (`evals/visual-quality/CALIBRATION.md`), but it needs
  humans: about 40 curated real artifacts, blind labels, and an authorised
  paid run. None of that exists yet. Don't fabricate labels or results.
- First live smoke run (2026-10-09, run `live-smoke`, barrel-triangle): it
  completed and the response passed validation unchanged. Response top-level
  keys are `answers`, `model` and `usage`. Usage has
  `input_tokens_details.{cached_tokens,cache_write_tokens}`. Score answers
  carry per-level labels. 2,665 input tokens for 3 × 768px images (auto
  detail) plus text, about 800 per image, so the default
  `--tokens-per-image 1600` is conservative. Latency was about 2.1 s and the
  cost $0.00027. The key was read from `.env` and isn't in any saved file.
- Commit with explicit pathspecs (`git commit -- <paths>`). The user had their
  own staged edit to the plan doc, and a plain commit swept it in once.

## Review fixes (2026-10-09)

An independent review of steps 1–5 found real issues, now fixed with
regression tests:

- Reports have to drop judgments of images that a later capture replaced.
  Judgment records now store `view_sha256`.
- A run can hold mock and live judgments. Reports use live results whenever
  any exist, and never blend the two.
- Repeat trials count only if their `cache_key` matches trial 0's. Old trials
  from an edited rubric otherwise looked like nondeterminism.
- Sample IDs are compared case-insensitively for duplicates (APFS is
  case-insensitive, so `Pine` and `pine` share a directory).
- The mock judge ignores paid request/cost limits.
- A retry is reserved before the backoff sleep.
- Agreement categories bucket by rounded level, so exact + adjacent equals
  within-one.
