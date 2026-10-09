import { sha256 } from "./canonical.ts";
import { labelFileSchema, type HumanLabel } from "./contracts.ts";
import { formatIssues } from "./dataset.ts";
import { readJson } from "./files.ts";

// Opaque ID shown in the blind labelling view instead of the sample ID, which
// may hint at the generator. Stable across runs, so labels outlive a run.
export function blindId(sampleId: string): string {
  return `b-${sha256(`vq-blind:${sampleId}`).slice(0, 10)}`;
}

export interface ResolvedLabel extends Omit<HumanLabel, "sample_id" | "blind_id"> {
  sample_id: string;
  source: string;
}

export interface LoadedLabels {
  bySample: Map<string, ResolvedLabel[]>;
  // Labels whose sample/blind ID isn't in the run; reported, not dropped silently.
  unmatched: Array<{ source: string; id: string }>;
}

export function loadLabelFiles(files: string[], sampleIds: string[]): LoadedLabels {
  const byBlind = new Map(sampleIds.map((id) => [blindId(id), id]));
  const known = new Set(sampleIds);
  const bySample = new Map<string, ResolvedLabel[]>();
  const unmatched: LoadedLabels["unmatched"] = [];

  for (const file of files) {
    const parsed = labelFileSchema.safeParse(readJson(file));
    if (!parsed.success) throw new Error(`${file}: ${formatIssues(parsed.error.issues).join("; ")}`);
    for (const label of parsed.data.labels) {
      const { sample_id, blind_id, ...rest } = label;
      const id = sample_id ?? byBlind.get(blind_id!);
      if (!id || !known.has(id)) {
        unmatched.push({ source: file, id: (sample_id ?? blind_id)! });
        continue;
      }
      const list = bySample.get(id) ?? [];
      if (list.some((existing) => existing.reviewer_id === rest.reviewer_id)) {
        throw new Error(`${file}: reviewer ${rest.reviewer_id} labelled ${sample_id ?? blind_id} more than once`);
      }
      list.push({ ...rest, sample_id: id, source: file });
      bySample.set(id, list);
    }
  }
  return { bySample, unmatched };
}

// The label compared against the judge: the chosen primary reviewer's, else
// the first label loaded for the sample.
export function primaryLabel(labels: ResolvedLabel[] | undefined, primaryReviewer?: string): ResolvedLabel | null {
  if (!labels?.length) return null;
  if (primaryReviewer) return labels.find((l) => l.reviewer_id === primaryReviewer) ?? null;
  return labels[0]!;
}
