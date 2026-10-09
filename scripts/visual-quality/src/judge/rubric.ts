import { readFileSync } from "node:fs";

import { z } from "zod";

import { sha256 } from "../canonical.ts";
import { DIMENSIONS, type Dimension } from "../contracts.ts";
import { formatIssues } from "../dataset.ts";

export const RUBRIC_FORMAT = "vq-rubric/v1";

const levelSchema = z.object({ label: z.string().min(1), description: z.string().min(1) }).strict();

export const rubricSchema = z
  .object({
    format: z.literal(RUBRIC_FORMAT),
    version: z.string().min(1),
    // Freeze before the holdout run; live holdout judging requires "frozen".
    status: z.enum(["draft", "frozen"]),
    notes: z.string().optional(),
    preamble: z.string().min(1),
    questions: z
      .array(
        z
          .object({
            name: z.enum(DIMENSIONS),
            applies_to: z.enum(["all", "visual_attributes_applicable"]),
            instructions: z.string().min(1),
            levels: z.array(levelSchema).length(4),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine((rubric) => new Set(rubric.questions.map((q) => q.name)).size === rubric.questions.length, {
    message: "question names must be unique",
  });

export type Rubric = z.infer<typeof rubricSchema>;
export type RubricQuestion = Rubric["questions"][number];

export interface LoadedRubric {
  rubric: Rubric;
  // Hash of the exact file bytes, so any wording change counts as a new rubric.
  sha256: string;
  text: string;
}

export function loadRubric(file: string): LoadedRubric {
  const text = readFileSync(file, "utf8");
  return parseRubric(text, file);
}

export function parseRubric(text: string, source = "rubric"): LoadedRubric {
  const parsed = rubricSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${source}: ${formatIssues(parsed.error.issues).join("; ")}`);
  return { rubric: parsed.data, sha256: sha256(text), text };
}

// Questions sent for a sample. Attribute fidelity is skipped (recorded as not
// applicable, never as a perfect score) when the curated sample has no
// explicit visual attributes.
export function applicableQuestions(rubric: Rubric, visualAttributesApplicable: boolean): RubricQuestion[] {
  return rubric.questions.filter((q) => q.applies_to === "all" || visualAttributesApplicable);
}

export function isDimension(name: unknown): name is Dimension {
  return (DIMENSIONS as readonly unknown[]).includes(name);
}
