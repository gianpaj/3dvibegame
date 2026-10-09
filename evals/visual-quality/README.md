# Visual-quality evaluation data

Inputs for the offline visual-quality harness (`scripts/visual-quality`, plan:
`docs/plans/2026-10-08-visual-quality-evaluation.md`).

| Path | Contents |
|---|---|
| `fixtures/` | Synthetic artifacts that exercise validation, capture and reporting. Their scores say nothing about judge accuracy. |
| `private/` | Git-ignored. Put feedback exports, curated imports and labels on private prompts here. |

Generated captures, API responses and reports go under `.tmp/visual-quality/`,
which is also ignored.

## Dataset manifest (`vq-dataset/v1`)

```jsonc
{
  "format": "vq-dataset/v1",
  "dataset_id": "synthetic-fixtures",
  "samples": [
    {
      "sample_id": "pine-tree",              // letters, digits, . _ -; used as a directory name
      "prompt_family_id": "tree",            // groups near-duplicates; a family may not span splits
      "split": "development",                // development | holdout | unassigned
      "sample_type": "single_object_create", // the only type v1 evaluates
      "prompt": "a pine tree",
      "builder_spec_path": "specs/pine-tree.builder.json", // or inline "builder_spec"
      "source_spec_path": "specs/pine-tree.source.json",   // optional, or inline "source_spec"
      "quantity": 1,                         // explicit single-object evidence
      "generator": { "model_id": "...", "prompt_version": "..." },
      "provenance": { "kind": "curated_fixture" },
      "visual_attributes_applicable": false  // human-authored; null = not yet curated
    }
  ]
}
```

The harness renders the **stored compiled builder spec**. It never recompiles
the source spec.

Samples are strict: unknown fields, including player identifiers, are
rejected. A sample that can't be evaluated gets one of these issues, each with
explicit reasons:

- `malformed`: doesn't match the contract (bad JSON, schema errors, negative
  dimensions, duplicate IDs, a prompt family in both splits).
- `unsupported`: out of v1 scope (edits, avatars, `quantity > 1`).
- `needs_curation`: a human decision is missing. Single-object scope can't be
  established, `visual_attributes_applicable` is null, or a feedback import
  hasn't had a privacy review.
- `artifact_failure`: the generator produced nothing renderable (no parts, no
  instances, or only zero-volume parts). This counts against the generator, not
  as a low visual score.

### Single-object scope

Scope needs evidence from manifest `quantity`, a `quantity` on the source spec,
or a raw voxel core (where an absent `quantity` means 1). `object_feedback`
stores the compiled `VoxelBuilderSpec`, which has no `quantity`. So imported
feedback always needs a human to confirm `quantity: 1`.

## Importing feedback

Export `object_feedback` rows as a JSON array (snake_case SQL columns or
camelCase SDK fields), then:

```sh
pnpm vq import-feedback --input evals/visual-quality/private/feedback.json --name feedback-2026-10
```

This writes `.tmp/visual-quality/imports/<name>/manifest.json`. Only allow-listed
fields are kept: prompt, both specs, model ID, prompt version and the player
rating (kept as a supporting signal). Player identity, nickname, world and
object IDs, operation IDs and timestamps are dropped. Edit records are excluded
because feedback has no before-spec snapshot.

Each imported sample needs curation before capture or judging:

1. Confirm the request was for one object and set `quantity: 1`.
2. Set `visual_attributes_applicable`.
3. Assign `prompt_family_id` and `split`.
4. Review the prompt for personal information (see `import-report.json` for
   heuristic flags), then set `provenance.privacy_reviewed: true`.

## Capturing views

```sh
pnpm vq capture [--dataset <manifest>] [--run <run-id>] [--samples a,b] [--no-reuse]
```

This validates the dataset, builds the development-only capture page
(`packages/3dvibegame-web/visual-quality/`), and renders three views per valid
sample in headless Chromium with software GL. Each sample is rendered through
the game's own `createAuthorityObject` in public state, under fixed neutral
lighting, at a fixed resolution and colour pipeline. The camera is fitted to
the object's vertices from three fixed directions (front three-quarter,
opposite three-quarter, elevated).

Captures are cached by artifact, renderer build hash, browser version and
settings. Re-running a command resumes an existing run. First-time setup:

```sh
pnpm --filter @3dvibegame/visual-quality exec playwright install chromium-headless-shell
```

Camera fitting normalises apparent size. These images don't establish world
scale, placement, hidden geometry or collision correctness. They're controlled
test views, not reconstructions of what the player saw.

## Judging

```sh
pnpm vq judge --run <run-id>            # dry run: prints the plan and worst-case cost
pnpm vq judge --run <run-id> --mock     # offline deterministic judge, no API calls
OPENAI_API_KEY=... pnpm vq judge --run <run-id> --execute --max-requests 20 --max-cost-usd 0.05
```

Each sample gets one `POST /v1/decisions` request (`gpt-6-luna`). It contains
the rubric preamble, the prompt as a JSON string marked as untrusted data, and
the three labelled views. Human labels, generator identity and spec JSON are
never sent. `rubric/v1.json` defines three independent 0–3 `score` questions.
Attribute fidelity is only asked when `visual_attributes_applicable` is true;
otherwise it's recorded as `not_applicable`, never as a score. The exact rubric
text is copied into each run and referenced by hash.

Results per question are `answered` (score, confidence, per-level
probabilities), `refused`, `missing`, `invalid` or `not_applicable`. A sample
is `completed`, `refused`, `incomplete` or `api_error`. A refusal or partial
answer is never turned into a zero.

Execution controls:

- Paid calls need both `--execute` and `OPENAI_API_KEY`. The key isn't written
  to records, and error text is redacted before it's saved.
- Bounded concurrency, a per-request deadline, and retries for transient
  failures only (timeouts, network errors, 408/409/429/5xx), with backoff that
  honours `Retry-After`.
- `--max-requests` counts every attempt, including retries. `--max-cost-usd`
  stops scheduling once reported usage plus estimates would exceed it. This
  isn't an exact dollar cap: requests in flight can finish after a limit is
  reached, and image tokens are estimated (`--tokens-per-image`) until the API
  reports usage.
- Completed results are reused only when the prompt, image hashes, applicable
  questions, exact rubric, model, image detail, request format and mock/live
  mode all match. Reused records keep their original `evaluated_at`.
  `--no-reuse` forces fresh calls. `--trials N` repeats judging for
  repeatability (only trial 0 may reuse).
- Live judging of `holdout` samples requires a rubric with `"status": "frozen"`.
