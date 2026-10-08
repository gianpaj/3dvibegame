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
