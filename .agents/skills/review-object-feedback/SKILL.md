---
name: review-object-feedback
description: >-
  Review 👎 (thumbs-down) player feedback on AI-generated/edited 3D objects and
  diagnose why the create or edit was wrong. Use when asked to analyse object
  feedback, review bad ratings, find AI generation failure patterns, or improve
  the voxel system prompts / assembler. Reads the `object_feedback` SpacetimeDB
  table via `spacetime sql`.
---

# Review object feedback

Player ratings (👍/👎) on AI create/edit results are stored in the **private**
`object_feedback` table in `world-backend` (see `docs/plans/object-feedback.md`).
Each row is a self-contained snapshot: the player's prompt + both spec JSONs +
the model and prompt version that produced the rated result. This skill walks
through pulling the 👎 rows and diagnosing **why** each result was bad so the
findings can feed prompt/assembler revisions.

## 0. Prerequisites

- The `spacetime` CLI must be logged in as the identity that published the
  module (the table is private — only an admin read works).
- Know the server + database. The local default is
  `--server http://127.0.0.1:3000 3dvibegame`. For a deployed world, substitute
  the real server URL (e.g. `--server https://…`). Ask the user if unsure.
- The SpacetimeDB SQL subset has **no `ORDER BY`, no aggregates, no `LIKE`**, but
  `WHERE col = 'value'` equality filters work. Pull rows and crunch locally.

Throughout, `SQL()` means:

```bash
spacetime sql --server <SERVER> <DATABASE> "<QUERY>"
```

## 1. Pull the bad rows (lightweight first)

Don't `SELECT *` first — `source_spec_json` / `builder_spec_json` are multi-KB and
flood the terminal. Start with the scalar columns to triage:

```bash
spacetime sql --server http://127.0.0.1:3000 3dvibegame \
  "SELECT feedback_id, operation, model_id, prompt_version, object_id, object_version, player_nickname, source_prompt FROM object_feedback WHERE rating = 'down'"
```

Note the `feedback_id`s. Also pull the 👍 rows for the same `model_id` /
`prompt_version` so you can compare what's working vs. failing:

```bash
spacetime sql --server http://127.0.0.1:3000 3dvibegame \
  "SELECT rating, operation, model_id, prompt_version FROM object_feedback"
```

Bucket 👍/👎 by `model_id` × `prompt_version` × `operation` — a failure
concentrated in one model or one prompt version is the strongest signal.

## 2. Drill into one bad row at a time

For each 👎 `feedback_id`, pull the full snapshot:

```bash
spacetime sql --server http://127.0.0.1:3000 3dvibegame \
  "SELECT source_prompt, operation, source_spec_json, builder_spec_json FROM object_feedback WHERE feedback_id = <ID>"
```

Two JSONs to read:

- **`source_spec_json`** — the **voxel core the LLM authored** (the thing being
  judged). Shape:
  ```jsonc
  {
    "object_category": "palm_tree",
    "size_tier": "tiny|small|medium|large",
    "style_tags": [...], "behaviors": [...],
    "materials": [{ "material_id": "...", "color_hint"?: "..." }],
    "operations": [ /* VoxelOp[] */ ],
    "quantity"?: 1
  }
  ```
  A `VoxelOp` is one of:
  - `{ op_id, kind:"add_box", position:[x,y,z], size:[w,h,d], material_id, tags? }`
  - `{ op_id, kind:"add_sphere", center:[x,y,z], radius, material_id, tags? }`
  - `{ op_id, kind:"add_line", from:[x,y,z], to:[x,y,z], radius, shape?, material_id, tags? }`
- **`builder_spec_json`** — the deterministic compiled output (`parts`,
  `instances`, `complexity.part_count`/`instance_count`). Usually the LLM core is
  the culprit; the builder spec mostly confirms the core compiled as authored.

If the JSON is hard to read inline, write it to a temp file and pretty-print it
(`jq`), but **do not** add it to the repo or commit it.

## 3. Diagnose: why was it wrong?

Read `source_prompt`, then judge the `operations` against it. Classify into one
or more failure categories:

| Category | What to look for |
|---|---|
| **Wrong silhouette / geometry** | Ops don't build the requested object's real shape (e.g. a "palm tree" with no tall trunk + splayed fronds; a "barrel" that isn't stacked cylinders/boxes). Too few ops to be recognisable. |
| **Ignored the prompt** | `object_category` or geometry unrelated to what was asked; key features from the prompt missing. |
| **Wrong / unrendered colors** | `material_id`s outside the allowed palette → render as a fallback. Allowed ids: `moss_stone, wood, neon, glass_block, jelly, cloud, lava_light, void, red, stone`. A `material_id` used in an op but **not declared** in `materials`. |
| **Wrong size / off the floor** | `size_tier` mismatched to the object; geometry not near `y=0` (floating or sunk); wildly out of the ~2–5 unit tall guidance. |
| **Degenerate spec** | Too few ops (<4), zero/negative dimensions or radius, duplicate `op_id`s, everything stacked at one point. |
| **Bad `quantity`** | `quantity` 2–4 when the count referred to *parts of one object* ("a tree with 2 apples"), or absent when the player asked for separate copies ("3 barrels"). |
| **Edit-specific** (`operation == "edit"`) | The edit **didn't preserve** unchanged parts — compare against what the prompt asked to change. A recolor that altered geometry; an "add X" that dropped existing ops; a change that touched the wrong part. (You usually can't see the pre-edit core in this row; infer from the prompt + result.) |

For **edits**, the prompt is the *change request* (e.g. "make it red"), not a
full description. Judge whether the result reflects only that change.

## 4. Cross-reference the system prompts

The instructions the model was given live in
`packages/ai-planning/src/contracts.ts`:

- `voxelBuilderSystemPrompt` — used for creates.
- `voxelEditSystemPrompt` — used for edits.
- `PROMPT_VERSION` — must match the row's `prompt_version`. If they differ, the
  row was produced by an older prompt; weight it accordingly and check whether the
  current prompt already addresses the failure.

For each failure, ask: **does the prompt already forbid/guide this, and the model
ignored it, or is the guidance missing/weak?** That determines the fix:

- *Model ignored explicit guidance* → consider a stronger/repositioned rule, an
  example, or a more capable `model_id`.
- *Guidance missing* → propose a new rule (and bump `PROMPT_VERSION`).
- *Compiler/assembler issue* (the core looked right but `builder_spec` is wrong)
  → look at `packages/ai-planning/src/specBuilder.ts` and the worker compile path.

## 5. Produce the report

Summarise — don't just dump rows. For each bad result:

```
feedback_id <ID> — <operation> — model <model_id> @ prompt <prompt_version>
  prompt: "<source_prompt>"
  result: <one-line description of what the ops actually built>
  failure: <category> — <specific reason>
  root cause: <model ignored rule X | rule missing | assembler bug>
  fix: <prompt change / example / model bump / assembler fix>
```

Then roll up:

- **Failure pattern frequency** — which category dominates the 👎 set.
- **By model / prompt version** — is one model or prompt version much worse?
- **Concrete recommendations** — prioritised prompt edits (with a `PROMPT_VERSION`
  bump), example additions, or assembler fixes. Tie each back to the rows it
  would have fixed.

## Guardrails

- **Read-only.** This skill only runs `spacetime sql` SELECTs. Never `UPDATE` /
  `DELETE` the feedback table, and never delete rows to "clean up".
- Don't commit any JSON you exported for inspection.
- Feedback rows snapshot what was true at submit time; an object may have been
  edited or deleted since, so don't expect the live world to still match.
- If you propose editing `voxelBuilderSystemPrompt` / `voxelEditSystemPrompt`,
  remember to bump `PROMPT_VERSION` so future 👍/👎 are attributable to the change.
```
