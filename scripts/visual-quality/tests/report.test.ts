import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIMENSIONS, type JudgmentRecord, type QuestionOutcome } from "../src/contracts.ts";
import { MockDecisionsClient } from "../src/judge/client.ts";
import { judgeRun } from "../src/judge/index.ts";
import { loadRubric } from "../src/judge/rubric.ts";
import { blindId, loadLabelFiles } from "../src/labels.ts";
import { evalsRoot } from "../src/paths.ts";
import { csvCell, resultsCsv } from "../src/report/csv.ts";
import { blindHtml, escapeHtml } from "../src/report/html.ts";
import { generateReport } from "../src/report/index.ts";
import {
  agreement,
  coverage,
  generatorComparison,
  repeatability,
  reviewerAgreement,
  usage,
} from "../src/report/metrics.ts";
import type { SampleResult } from "../src/report/results.ts";
import { sampleDir } from "../src/run.ts";
import { fabricateCapturedRun } from "./helpers.ts";

const rubric = loadRubric(path.join(evalsRoot, "rubric", "v1.json"));

function answered(score: number): QuestionOutcome {
  return { state: "answered", score, confidence: 0.5, probabilities: [] };
}

function judgment(overrides: Partial<JudgmentRecord> = {}): JudgmentRecord {
  return {
    format: "vq-judgment/v1",
    sample_id: "s",
    trial: 0,
    status: "completed",
    error: null,
    warnings: [],
    cache_key: "k",
    reused_from: null,
    judge: { model: "gpt-6-luna", request_format: "r", image_detail: "auto", mock: false },
    rubric: { version: "v1", sha256: "x" },
    questions: {
      recognizability: answered(2),
      attribute_fidelity: { state: "not_applicable" },
      visual_coherence: answered(2),
    },
    response_model: null,
    usage: { input_tokens: 1_000, output_tokens: 0, total_tokens: 1_000 },
    estimated_cost_usd: 0.0001,
    attempts: [{ started_at: "t", duration_ms: 10, http_status: 200, error: null, transient: false }],
    judge_latency_ms: 10,
    evaluated_at: "2026-10-08T00:00:00Z",
    ...overrides,
  };
}

let counter = 0;
type ResultOverrides = Partial<Omit<SampleResult, "human">> & {
  // Fields of the primary human label, or null for an unlabelled sample.
  human?: Record<string, unknown> | null;
};

function result(overrides: ResultOverrides = {}): SampleResult {
  const id = `s${counter++}`;
  const { human, ...rest } = overrides;
  const label = human === null || human === undefined
    ? null
    : ({
        sample_id: id,
        source: "test",
        reviewer_id: "r1",
        recognizability: 2,
        attribute_fidelity: "not_applicable",
        visual_coherence: 2,
        ...human,
      } as SampleResult["human"]["primary"]);
  return {
    sample_id: id,
    blind_id: blindId(id),
    prompt: "a thing",
    prompt_family_id: `family-${id}`,
    split: "development",
    generator: { model_id: "gen-a", prompt_version: "v1" },
    provenance_kind: "curated_fixture",
    player_rating: null,
    visual_attributes_applicable: false,
    status: "completed",
    input_issue: null,
    reasons: [],
    capture: null,
    judgments: [judgment()],
    scores: {
      recognizability: answered(2),
      attribute_fidelity: { state: "not_applicable" },
      visual_coherence: answered(2),
    },
    human: { primary: label, all: label ? [label] : [] },
    ...rest,
  };
}

function withScore(dimension: "recognizability" | "attribute_fidelity" | "visual_coherence", outcome: QuestionOutcome) {
  return { recognizability: answered(2), attribute_fidelity: { state: "not_applicable" }, visual_coherence: answered(2), [dimension]: outcome } as SampleResult["scores"];
}

describe("labels", () => {
  function labelFile(labels: unknown[]) {
    const file = path.join(tmpdir(), `vq-labels-${counter++}.json`);
    writeFileSync(file, JSON.stringify({ format: "vq-labels/v1", labels }));
    return file;
  }
  const base = { reviewer_id: "r1", recognizability: 2, attribute_fidelity: "not_applicable", visual_coherence: 3 };

  it("resolves blind IDs back to sample IDs and reports unmatched labels", () => {
    const file = labelFile([{ ...base, blind_id: blindId("pine-tree") }, { ...base, sample_id: "nope" }]);
    const loaded = loadLabelFiles([file], ["pine-tree"]);
    expect(loaded.bySample.get("pine-tree")?.[0]?.recognizability).toBe(2);
    expect(loaded.unmatched).toEqual([{ source: file, id: "nope" }]);
  });

  it("rejects duplicate labels from one reviewer and out-of-range levels", () => {
    expect(() =>
      loadLabelFiles([labelFile([{ ...base, sample_id: "a" }, { ...base, sample_id: "a" }])], ["a"]),
    ).toThrow(/more than once/);
    expect(() => loadLabelFiles([labelFile([{ ...base, sample_id: "a", recognizability: 4 }])], ["a"])).toThrow();
    expect(() => loadLabelFiles([labelFile([{ ...base }])], ["a"])).toThrow(/exactly one of sample_id or blind_id/);
  });

  it("gives stable, opaque blind IDs", () => {
    expect(blindId("pine-tree")).toBe(blindId("pine-tree"));
    expect(blindId("pine-tree")).not.toContain("pine");
  });
});

describe("metrics", () => {
  it("counts coverage with explicit denominators and keeps failures distinct", () => {
    const results = [
      result(),
      result({ status: "api_error", scores: withScore("recognizability", { state: "missing" }) }),
      result({ status: "refused" }),
      result({ status: "capture_failed", judgments: [], capture: {} as SampleResult["capture"] }),
      result({ status: "input_invalid", input_issue: "artifact_failure", judgments: [] }),
    ];
    const c = coverage(results);
    expect(c.evaluated).toEqual({ count: 1, of: 5, rate: 0.2 });
    expect(c.api_errors).toEqual({ count: 1, of: 3, rate: 1 / 3 });
    expect(c.refusals.count).toBe(1);
    expect(c.capture_failures).toEqual({ count: 1, of: 1, rate: 1 });
    expect(c.input_issues.artifact_failure).toBe(1);
  });

  it("computes error, rounded-level agreement and disagreement categories", () => {
    const results = [
      result({ scores: withScore("recognizability", answered(2.4)), human: { recognizability: 2 } }), // exact
      result({ scores: withScore("recognizability", answered(1.6)), human: { recognizability: 1 } }), // adjacent
      result({ scores: withScore("recognizability", answered(2.6)), human: { recognizability: 0 } }), // over, false pass
      result({ scores: withScore("recognizability", answered(0.8)), human: { recognizability: 3 } }), // under, false fail
      result({ scores: withScore("recognizability", { state: "refused" }), status: "refused", human: { recognizability: 3 } }),
      result({ human: null }),
    ];
    const a = agreement(results, "recognizability");
    expect(a.n).toBe(4);
    expect(a.mean_absolute_error).toBeCloseTo((0.4 + 0.6 + 2.6 + 2.2) / 4);
    expect(a.bias).toBeCloseTo((0.4 + 0.6 + 2.6 - 2.2) / 4);
    expect(a.exact).toEqual({ count: 1, of: 4, rate: 0.25 });
    expect(a.within_one).toEqual({ count: 2, of: 4, rate: 0.5 });
    expect(a.categories).toEqual({ exact: 1, adjacent: 1, over: 1, under: 1 });
    expect(a.false_pass).toEqual([results[2]!.sample_id]);
    expect(a.false_fail).toEqual([results[3]!.sample_id]);
    expect(a.excluded.ai_not_answered).toEqual([results[4]!.sample_id]);
  });

  it("keeps not-applicable attribute fidelity out of the pairs and flags applicability mismatches", () => {
    const results = [
      result({ human: { attribute_fidelity: "not_applicable" } }),
      result({ human: { attribute_fidelity: 2 } }),
      result({ scores: withScore("attribute_fidelity", answered(3)), human: { attribute_fidelity: "not_applicable" } }),
      result({ scores: withScore("attribute_fidelity", answered(3)), human: { attribute_fidelity: 3 } }),
    ];
    const a = agreement(results, "attribute_fidelity");
    expect(a.n).toBe(1);
    expect(a.excluded.applicability_mismatch).toEqual([results[1]!.sample_id, results[2]!.sample_id]);
  });

  it("measures repeatability across completed trials", () => {
    const trials = [2, 2.4, 1.8].map((score, trial) =>
      judgment({ trial, questions: { recognizability: answered(score), attribute_fidelity: { state: "not_applicable" }, visual_coherence: answered(1) } }),
    );
    const rep = repeatability([result({ judgments: trials }), result()]);
    expect(rep.recognizability.samples).toBe(1);
    expect(rep.recognizability.max_range).toBeCloseTo(0.6);
    expect(rep.recognizability.stable_level).toEqual({ count: 1, of: 1, rate: 1 });
    expect(rep.attribute_fidelity.samples).toBe(0);
  });

  it("compares reviewers pairwise", () => {
    const r = result({ human: { recognizability: 3 } });
    r.human.all.push({ ...r.human.primary!, reviewer_id: "r2", recognizability: 1 });
    const agreementByDim = reviewerAgreement([r]);
    expect(agreementByDim.recognizability).toMatchObject({ pairs: 1, exact: { count: 0 }, within_one: { count: 0 } });
    expect(agreementByDim.visual_coherence.exact.count).toBe(1);
  });

  it("hides generator means when coverage isn't comparable", () => {
    const comparable = generatorComparison([
      result({ prompt_family_id: "tree" }),
      result({ prompt_family_id: "tree", generator: { model_id: "gen-b", prompt_version: "v1" } }),
    ]);
    expect(comparable.comparable).toBe(true);
    expect(comparable.groups[0]!.means?.recognizability).toEqual({ mean: 2, n: 1 });

    const failed = generatorComparison([
      result({ prompt_family_id: "tree" }),
      result({ prompt_family_id: "tree", generator: { model_id: "gen-b", prompt_version: "v1" }, status: "api_error" }),
    ]);
    expect(failed.comparable).toBe(false);
    expect(failed.reason).toMatch(/coverage/);
    expect(failed.groups.every((g) => g.means === null)).toBe(true);
    expect(failed.groups[1]!.by_status.api_error).toBe(1);

    const families = generatorComparison([
      result({ prompt_family_id: "tree" }),
      result({ prompt_family_id: "rock", generator: { model_id: "gen-b", prompt_version: "v1" } }),
    ]);
    expect(families.reason).toMatch(/prompt families/);
  });

  it("counts only fresh work toward usage", () => {
    const u = usage([result({ judgments: [judgment(), judgment({ trial: 1, reused_from: "earlier" })] })]);
    expect(u).toMatchObject({ fresh_judgments: 1, reused_judgments: 1, requests: 1, input_tokens: 1_000 });
  });
});

describe("CSV", () => {
  it("guards against formula injection and quotes delimiters", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell(null)).toBe("");
  });

  it("writes not-applicable and refused scores as states, never as zero", () => {
    const csv = resultsCsv([result({ scores: withScore("visual_coherence", { state: "refused" }) })]);
    const [header, row] = csv.trim().split("\n").map((line) => line.split(","));
    const col = (name: string) => row![header!.indexOf(name)];
    expect(col("attribute_fidelity_state")).toBe("not_applicable");
    expect(col("attribute_fidelity_score")).toBe("");
    expect(col("visual_coherence_state")).toBe("refused");
    expect(col("visual_coherence_score")).toBe("");
  });
});

const malicious = `</blockquote><script>alert("x")</script><img src="https://evil.example/p.png" onerror=alert(1)>`;

describe("HTML", () => {
  it("escapes markup-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("blind view shows prompt and views only, escaped", () => {
    const html = blindHtml(
      [{ blind_id: "b-123", prompt: malicious, views: [{ label: "View 1 of 3", src: "blind/b-123-front.png" }] }],
      rubric.rubric,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('src="https://evil.example');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Content-Security-Policy");
  });
});

describe("generateReport", () => {
  it("produces offline reports that keep failures, N/A and blind identities separate", async () => {
    fabricateCapturedRun("report-e2e", "report-e2e", ["flat-rug"]);
    // Give one sample a hostile prompt to check escaping end to end.
    const sampleFile = path.join(sampleDir("report-e2e", "color-swatch"), "sample.json");
    const stored = JSON.parse(readFileSync(sampleFile, "utf8"));
    stored.sample.prompt = malicious;
    writeFileSync(sampleFile, JSON.stringify(stored));
    await judgeRun("report-e2e", {
      client: new MockDecisionsClient(),
      config: { model: "gpt-6-luna", image_detail: "auto" },
      rubric,
      limits: { maxRequests: 100, maxCostUsd: 1, usdPerInputToken: 1e-7 },
      concurrency: 2,
      deadlineMs: 1_000,
      maxRetries: 0,
      reuse: false,
      trials: 1,
      estimatedTokensPerImage: 100,
    });
    const report = generateReport("report-e2e", { labelFiles: [path.join(evalsRoot, "fixtures", "labels.json")] });
    const results = JSON.parse(readFileSync(path.join(report.outDir, "results.json"), "utf8"));

    expect(results.mock).toBe(true);
    expect(results.coverage.by_status).toMatchObject({ completed: 6, capture_failed: 1, input_invalid: 5 });
    expect(results.coverage.evaluated).toEqual({ count: 6, of: 12, rate: 0.5 });
    const pine = results.samples.find((s: { sample_id: string }) => s.sample_id === "pine-tree");
    expect(pine.scores.attribute_fidelity).toEqual({ state: "not_applicable" });
    // The flat-rug capture failed, so its labels can't pair with an AI score.
    expect(results.calibration.holdout.dimensions.recognizability.excluded.ai_not_answered).toContain("flat-rug");
    expect(results.reviewer_agreement.recognizability.pairs).toBe(3);
    expect(report.labelled).toBe(7);

    const blind = readFileSync(path.join(report.outDir, "blind.html"), "utf8");
    for (const leak of ["pine-tree", "synthetic-fixture", "fixture-v1", 'class="status', "AI (score"]) {
      expect(blind).not.toContain(leak);
    }
    expect(blind).toContain(blindId("pine-tree"));

    const index = readFileSync(path.join(report.outDir, "index.html"), "utf8");
    expect(index).toContain("Mock judge");
    for (const html of [index, blind]) {
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    }
    const csv = readFileSync(path.join(report.outDir, "results.csv"), "utf8");
    expect(csv).toContain('"</blockquote><script>alert(""x"")');
    expect(index).not.toMatch(/(src|href)="https?:/);
    for (const d of DIMENSIONS) expect(index).toContain(`data-${d}=`);
  });
});
