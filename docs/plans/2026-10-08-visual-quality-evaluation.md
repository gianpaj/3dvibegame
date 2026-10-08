# Offline visual-quality evaluation

Status: proposed implementation plan. No implementation is included.

## Goal

Measure whether a rendered Vibe World object visibly satisfies the player's prompt. Use the results to compare generators, tune generation prompts, and detect visual regressions.

The first release evaluates saved artifacts. It does not generate objects, block player actions, or change the live creation pipeline.

## Scope

Include:

- Single-object creation results with a prompt and a compiled builder spec.
- Controlled multi-view rendering using the player app's mesh code.
- OpenAI Decisions evaluation of recognizability, requested attributes, and visual coherence.
- Human labels, a development/holdout split, and a local review report.
- Recorded inputs, versions, usage, latency, failures, and resumable execution.

Exclude:

- Live quality gates, automatic retries of object generation, and candidate generation.
- Edit-preservation evaluation, avatars, multi-object requests, and scene-relative placement.
- Absolute-size evaluation from camera-fitted screenshots.
- Backend schema changes, a hosted dashboard, or integration into the Python planning bench.
- Replacing deterministic schema, bounds, count, or permission checks with model judgments.

## Architecture

```text
Saved prompt + compiled spec
  → local validation and scope checks
  → controlled renderer
  → three saved views
  → Decisions API
  → versioned results
  → static review gallery + JSON/CSV

Human labels ───────────────────────→ evaluation report
```

Keep the harness in `3dvibegame` so it evaluates the actual game renderer rather than a Python approximation. Keep visual results separate from the existing planning benchmark's deterministic scores.

### Existing integration points

- `packages/3dvibegame-web/src/viewer/objects/createAuthorityObject.ts`: construct object meshes with the game's material and color handling.
- `packages/3dvibegame-web/src/scene/AuthorityObject.tsx`: existing player-app consumer of that mesh factory.
- `packages/scene-authority-ts`: shared artifact contracts and validation.
- `packages/world-backend/src/schema.ts`: `object_feedback` snapshots include prompt, source spec, compiled spec, model, and prompt version.
- `docs/plans/object-feedback.md`: feedback provenance and lifecycle context.

Do not change `packages/ai-worker` or SpacetimeDB to support offline evaluation.

### Proposed file ownership

These are implementation destinations, not existing files:

- `scripts/visual-quality/`: CLI orchestration, input validation, Decisions client, result persistence, and report generation.
- `packages/3dvibegame-web/visual-quality/`: development-only capture entry importing the existing mesh factory; not linked from or included as an entry in the production app.
- `evals/visual-quality/`: curated synthetic/public fixtures, manifests, rubric definitions, and human-label format.
- `.tmp/visual-quality/`: ignored local imports, captures, API responses, and generated reports.

Use the repository's TypeScript tooling. Reuse browser automation support if available; otherwise add one development-only headless-browser dependency. Do not create a generic evaluation framework or duplicate the renderer.

## 1. Dataset and input contract

Each sample contains:

- Stable sample ID, prompt-family ID, and development/holdout assignment.
- Creation prompt and compiled builder spec.
- Optional source spec, generator model, and generation-prompt version.
- Provenance identifying a curated fixture or a local feedback export.
- A human-authored flag indicating whether explicit visual attributes are applicable.

Validate inputs before rendering. Reject malformed specs and unsupported sample types with explicit reasons. Empty geometry is an artifact failure, not a low visual score.

Start with curated artifacts and optionally import exported `object_feedback` rows. Import only creation records whose single-object scope can be established; ambiguous records require manual curation. A source spec or explicit manifest metadata may be needed to verify quantity.

Render the stored compiled spec when replaying feedback. Do not silently recompile the source: that would evaluate a different artifact. A future compiler-regression mode can compare stored and recompiled outputs explicitly.

Strip player identities, nicknames, world IDs, and unrelated metadata from imported evaluation data. Review prompts for personal information before external evaluation. Keep private exports and their reports out of Git.

Feedback edit records do not contain a before-spec snapshot. Exclude them from edit-preservation evaluation rather than inferring missing state.

## 2. Controlled capture

Create a small capture page that imports `createAuthorityObject` directly. It must work without a backend connection, player identity, live world, or API key.

Render each artifact with:

- Public object state, no selection or lifecycle rings.
- Fixed neutral background and lighting; no UTC day/night cycle.
- Fixed resolution, device pixel ratio, tone mapping, and color-space settings.
- Three labeled views: front three-quarter, opposite three-quarter, and elevated.
- Camera distance derived from actual mesh bounds with consistent padding.
- A fixed object orientation; do not rotate each sample to a hand-picked best view.
- No animation, HUD, surrounding objects, or generator labels.

Use the existing material/color path, including compiled `color_hint` behavior. Record camera transforms, object bounds, capture settings, dependency versions, and renderer revision.

The harness must wait for an explicit render-ready signal, detect browser errors, enforce a timeout, and clean up the page and browser resources. A failed capture must not trigger a paid judge call.

Camera fitting normalizes apparent size. The report must state that these images do not establish world scale, placement, hidden geometry, or collision correctness. Captures are controlled test views, not reconstructions of the player's original lighting and camera.

## 3. Visual rubric

Send the creation prompt and all three labeled images in one Decisions request. Do not send human ratings, generator identity, or compiled JSON: this pass judges visible output, not metadata.

Treat the player prompt as untrusted task data, not evaluator instructions. Judge intentional voxel/blocky styling on its own terms; do not reward photorealism or penalize requested abstract, floating, or disconnected forms.

Use independent ordered scores with indices 0–3:

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Recognizability | Wrong subject or unrecognizable | Relevant fragments but unclear subject | Recognizable with major omissions/distortions | Clear subject with defining features |
| Attribute fidelity | Requested visual attributes contradicted or absent | Most requested attributes missing/incorrect | Most present with a material discrepancy | Requested visible attributes satisfied |
| Visual coherence | Severe unintended-looking breakup/overlap | Major defects obscure the intended form | Minor visible defects | Coherent form with no clear unintended defects |

Skip attribute fidelity when the curated sample has no explicit visual attributes. Record this as not applicable, not a perfect score. Unsupported or nonvisual requirements do not become visual criteria.

Do not collapse the dimensions into an overall quality number in v1. Decisions scores are probability-weighted level indices, not necessarily integers. Persist per-level probabilities and confidence alongside each score.

Version the rubric and include its exact instructions in run artifacts. A refusal or incomplete answer is an evaluation status, never an automatic zero. Do not fabricate explanatory prose from numeric answers; human review supplies diagnostic notes.

## 4. Decisions integration and execution controls

Use the documented `POST /v1/decisions` endpoint with `gpt-6-luna`, subject to availability verification at implementation time. Keep the API key in the local runner environment, never in browser code, Vite-exposed variables, artifacts, or logs.

Separate capture, judging, and reporting commands so existing images can be judged without rerendering and reports can be regenerated without network access. Paid execution must be explicit; offline fixture runs remain the default validation path.

The runner must:

- Validate response question names, types, score ranges, and probability distributions.
- Preserve valid answers when another question fails, marking the sample incomplete.
- Distinguish input-invalid, capture-failed, API-error, refused, incomplete, and completed states.
- Use bounded concurrency, request deadlines, and bounded retries for transient failures only.
- Enforce a maximum paid-request count that includes retries.
- Track reported usage and estimated cost; stop further scheduling at the configured spending limit.
- Disclose that in-flight requests and image-token estimation prevent an exact hard dollar cap.
- Redact credentials and avoid logging private prompt content unnecessarily.

For result reuse, hash the prompt, image contents, applicable questions, exact rubric, judge model/configuration, and API request format. Capture reuse also depends on artifact contents and renderer/capture versions. Never reuse results after a relevant input changes. Preserve the evaluation timestamp because a model alias may change behavior over time.

Store a run manifest and per-sample inputs, images, responses, usage, timings, and statuses. Keep generator latency separate from capture and judge latency. The saved-artifact workflow has no newly measured generation latency.

Reference: https://developers.openai.com/api/docs/guides/decisions.md

## 5. Human calibration

Prepare approximately 40 reviewed examples before treating scores as meaningful quality evidence. Include clear successes, wrong subjects, missing defining parts, wrong colors, distorted proportions, and plausible-looking objects that miss the prompt. Include intentional abstract/disconnected designs to test false penalties.

Assign approximately half to development and half to holdout, grouped by prompt family and related artifact variants. Do not let near-duplicates cross splits. Tune rubric wording on development examples only; freeze the rubric before the holdout run.

Reviewers score the same prompt and images without seeing model identity or AI scores. Where feasible, use a second reviewer on a subset to identify subjective criteria. Treat player thumbs-up/down as supporting signals rather than dimension-level ground truth.

Report:

- Per-dimension absolute error and exact/within-one-level agreement with human scores.
- Severe human-labeled failures receiving high AI scores, and successful objects receiving low scores.
- Counts and examples for each disagreement category, with explicit denominators.
- Repeatability from repeated judging of a fixed subset with result reuse disabled.
- Capture/API failure rates, evaluation coverage, latency, and measured usage/cost.

Define development-only diagnostic bins before inspecting holdout results. Do not introduce a production pass/fail threshold or claim general reliability from this small pilot. Render and API failures remain visible in coverage reporting so model comparisons do not silently exclude unsuccessful samples.

## 6. Review report

Generate a static local HTML gallery and machine-readable JSON/CSV. Each sample shows its prompt, views, dimension scores, human labels/notes, evaluation status, and provenance. Reveal generator identity only in the comparison report, not the blind-labeling view.

Support basic sorting/filtering by status, dimension, and disagreement without building a hosted dashboard. Escape prompt and note text when generating HTML. Keep images local; viewing a report must not contact OpenAI or another external service.

Aggregate results by generator/prompt version only when sample coverage is comparable. Show sample counts and missing evaluations. Keep these scores separate from deterministic planning scores and avoid ranking models with a single blended number.

## Implementation sequence

### Step 1 — Contracts and fixtures

- Define sample, capture, judge-result, human-label, and run-manifest formats.
- Add scope validation and a sanitized feedback-import path.
- Add a small synthetic fixture set covering valid, malformed, empty, colored, and unsupported artifacts.
- Ensure private exports and generated outputs are ignored by Git.

Acceptance: fixtures validate offline; unsupported samples have explicit reasons; imports exclude player identifiers.

### Step 2 — Capture harness

- Add the isolated capture entry and bounded browser runner.
- Reuse the existing mesh factory and record capture provenance.
- Save three views per valid artifact and expose a clear readiness contract.

Acceptance: repeated captures in the same pinned environment preserve framing and appearance; blank/failed renders are detected; material colors and extreme aspect ratios have regression coverage. Avoid requiring byte-identical images across different GPUs.

### Step 3 — Judge runner

- Implement the versioned rubric, request construction, response validation, persistence, and result reuse.
- Add explicit paid execution, limits, retries, redaction, and usage accounting.
- Test with mocked API responses before running a small authorized live smoke.

Acceptance: refusal, timeout, partial answers, transient errors, and changed rubric/image inputs behave correctly; reused results cause no API calls; credentials never enter saved artifacts.

### Step 4 — Labels and reports

- Add a simple human-label file format and blind review output.
- Generate the static gallery and JSON/CSV summaries.
- Add agreement, disagreement, repeatability, and coverage metrics.

Acceptance: reports work offline; non-applicable scores and failures stay distinct; malicious prompt text is escaped; aggregates use the correct denominators.

### Step 5 — Calibration pilot

- Curate the development/holdout collection and collect human labels.
- Run development evaluation, revise only the development rubric, then freeze it.
- Run holdout evaluation and repeatability checks within the approved request budget.
- Record whether the judge is useful for offline comparisons and which failure modes remain unreliable.

Acceptance: the pilot produces auditable evidence and examples, not a live quality gate. Broader model comparisons, Python-bench ingestion, edit evaluation, and production use require separate follow-up decisions.

## Validation strategy

Keep contract, rubric, scoring, report, and mocked-client tests network-free. Add a browser smoke for the capture pipeline and run the affected web-package typecheck/build to ensure the evaluation entry does not alter the production bundle. A full offline fixture run must exercise validation → capture → mocked judging → report generation.

Run paid API checks only with an explicit key and execution flag. Report actual calls, usage, failures, and unverified assumptions. Do not treat mocked success as evidence of visual-judge accuracy.
