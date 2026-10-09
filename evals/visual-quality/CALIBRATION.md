# Calibration pilot runbook

Step 5 of `docs/plans/2026-10-08-visual-quality-evaluation.md`. The goal is
auditable evidence of whether the Decisions judge is useful for offline
comparisons, and which failure modes it can't be trusted on. The pilot doesn't
produce a live quality gate, a pass/fail threshold, or a general reliability
claim.

Keep the pilot dataset, imports and labels under `evals/visual-quality/private/`
(git-ignored) unless every prompt is synthetic or public.

## 1. Curate about 40 examples

Build a `vq-dataset/v1` manifest (see `README.md`) from curated artifacts and
optionally curated feedback imports (`pnpm vq import-feedback`). Aim for a mix
of:

- clear successes;
- wrong subjects;
- missing defining parts (a chair without legs, a tree without a trunk);
- wrong colours (including `color_hint` failures);
- distorted proportions;
- plausible-looking objects that miss the prompt;
- intentionally abstract, floating or disconnected designs (to catch false
  coherence penalties);
- prompts with and without explicit visual attributes (to exercise
  `not_applicable`).

For every sample, set `prompt_family_id` so near-duplicates and variants of one
request share a family. Assign about half the families to `development` and
half to `holdout`. A family never spans both, and `pnpm vq validate` rejects one
that does.

```sh
pnpm vq validate --dataset evals/visual-quality/private/pilot/manifest.json
```

## 2. Capture and label blind

```sh
pnpm vq capture --dataset evals/visual-quality/private/pilot/manifest.json --run pilot
pnpm vq report --run pilot
```

Reviewers open `.tmp/visual-quality/runs/pilot/report/blind.html`. It shows
only the prompt and views, under blind IDs. Reviewers score each dimension
against the rubric legend, add notes for anything diagnostic, then download
their labels file into `evals/visual-quality/private/labels/`. Don't show
reviewers AI scores or generator identity before they finish.

Where feasible, have a second reviewer label a subset (about 10 samples) to
find subjective criteria. Player thumbs up/down is a supporting signal only.

## 3. Development run and rubric tuning

Check the plan and cost first, then run on development samples only:

```sh
pnpm vq judge --run pilot --split development              # dry run
OPENAI_API_KEY=... pnpm vq judge --run pilot --split development --execute \
  --max-requests 40 --max-cost-usd 0.10
pnpm vq report --run pilot --labels evals/visual-quality/private/labels/r1.json,evals/visual-quality/private/labels/r2.json
```

Read the development agreement table and the disagreement examples. Revise
wording in `rubric/v1.json` based on development examples only. Each edit
changes the rubric hash, so the next judge run calls the API again instead of
reusing stale results. If you change the diagnostic bins
(`src/report/metrics.ts`), do it now and bump their version.

Don't open holdout cards in the comparison report while tuning. Filter it to
`development`.

## 4. Freeze, then run the holdout

Set `"status": "frozen"` in the rubric and commit it. After this, any change
needs a new version file (`rubric/v2.json`). Live judging of holdout samples
refuses a draft rubric.

```sh
OPENAI_API_KEY=... pnpm vq judge --run pilot --split holdout --execute \
  --max-requests 40 --max-cost-usd 0.10
```

The report warns if a split's judgments mix rubric texts.

## 5. Repeatability

Pick a fixed subset of about 10 samples spanning the score range and judge it
repeatedly with reuse disabled:

```sh
OPENAI_API_KEY=... pnpm vq judge --run pilot --samples "<ids>" --execute \
  --trials 3 --no-reuse --max-requests 40 --max-cost-usd 0.10
pnpm vq report --run pilot --labels <label files>
```

The report's repeatability table shows score ranges, SDs and how often the
rounded level is stable across trials.

## 6. Record the findings

Copy this template into a dated note (for example
`docs/plans/<date>-visual-quality-pilot-results.md`) and fill it in from the
holdout report. Use counts with denominators, not bare percentages.

```markdown
# Visual-quality pilot results (<date>)

- Run: <run-id>, git <commit>, rubric <version> (<sha8>), judge gpt-6-luna
- Samples: <n> development / <n> holdout; labelled <n>/<n>; second reviewer on <n>
- Coverage (holdout): completed <n>/<n>, capture failures <n>/<n>, API errors <n>/<n>, refusals <n>/<n>
- Requests: <n> (<n> retries); reported input tokens <n>; estimated cost $<x>

| Dimension | Pairs | MAE | Bias | Exact | Within one | Severe failure, high AI | Success, low AI |
|---|---|---|---|---|---|---|---|
| Recognizability | | | | | | | |
| Attribute fidelity | | | | | | | |
| Visual coherence | | | | | | | |

- Repeatability: mean range <x>, max range <x>, stable level <n>/<n>
- Inter-reviewer agreement: exact <n>/<n>, within one <n>/<n>; subjective criteria: <...>

## Verdict

- Useful for offline generator/prompt comparisons? <yes/no/partially, and for which dimensions>
- Failure modes the judge is unreliable on: <examples by sample, with notes>
- Assumptions still unverified: <...>
- Follow-ups (each needs its own decision): broader comparisons, Python-bench ingestion,
  edit evaluation, any production use.
```
