import { DIMENSIONS, type Dimension, type QuestionOutcome, type RunManifest } from "../contracts.ts";
import type { Rubric } from "../judge/rubric.ts";
import {
  DIAGNOSTIC_BINS,
  type CalibrationSplit,
  type Coverage,
  type GeneratorComparison,
  type LatencySummary,
  type Repeatability,
  type ReviewerAgreement,
  type Share,
  type UsageSummary,
} from "./metrics.ts";
import { SAMPLE_STATUSES, type SampleResult } from "./results.ts";

// Static, offline HTML. Every piece of dataset text (prompts, notes, reasons,
// IDs) goes through escapeHtml; scripts never use innerHTML; the CSP forbids
// any network access, so opening a report contacts no external service.

const CSP =
  "default-src 'none'; img-src 'self' file: data:; style-src 'unsafe-inline'; " +
  "script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DIMENSION_LABELS: Record<Dimension, string> = {
  recognizability: "Recognizability",
  attribute_fidelity: "Attribute fidelity",
  visual_coherence: "Visual coherence",
};

export const SCALE_DISCLAIMER =
  "Views are controlled test renders with the camera fitted to the object, so apparent size is normalised. " +
  "They don't establish world scale, placement, hidden geometry or collision correctness, and they don't " +
  "reconstruct the lighting or camera the player saw.";

export interface ReportModel {
  manifest: RunManifest;
  generatedAt: string;
  results: SampleResult[];
  coverage: Coverage;
  calibration: Record<"development" | "holdout", CalibrationSplit> | null;
  reviewers: Record<Dimension, ReviewerAgreement> | null;
  repeatability: Record<Dimension, Repeatability>;
  comparison: GeneratorComparison;
  timings: { capture: LatencySummary; judge: LatencySummary };
  usage: UsageSummary;
  rubricVersions: string[];
  unmatchedLabels: number;
  imagePath(sampleId: string, file: string): string;
}

export function reportHtml(model: ReportModel): string {
  const { manifest } = model;
  const body = [
    `<h1>Visual-quality report — ${escapeHtml(manifest.run_id)}</h1>`,
    `<p class="meta">Dataset <code>${escapeHtml(manifest.dataset.dataset_id)}</code> (${escapeHtml(manifest.dataset.path)}),
      created ${escapeHtml(manifest.created_at)}, report generated ${escapeHtml(model.generatedAt)}.
      Git ${escapeHtml(manifest.git.commit?.slice(0, 12) ?? "unknown")}${manifest.git.dirty ? " (dirty)" : ""}.
      Rubric ${escapeHtml(model.rubricVersions.join(", ") || "—")}.</p>`,
    model.usage.mock
      ? `<p class="banner">Mock judge: scores in this run are synthetic and say nothing about visual quality.</p>`
      : "",
    `<p class="note">${escapeHtml(SCALE_DISCLAIMER)} This is an offline pilot, not a quality gate: small samples don't
      support general reliability claims, and there is deliberately no blended overall score.</p>`,
    coverageSection(model.coverage),
    calibrationSection(model),
    reviewerSection(model.reviewers),
    repeatabilitySection(model.repeatability),
    comparisonSection(model.comparison),
    costSection(model),
    samplesSection(model),
  ].join("\n");
  return page(`Visual-quality report — ${model.manifest.run_id}`, body, FILTER_SCRIPT);
}

function coverageSection(c: Coverage) {
  const rows = SAMPLE_STATUSES.map(
    (s) => `<tr><td><span class="status s-${s}">${s}</span></td><td>${shareText({ count: c.by_status[s], of: c.total, rate: c.total ? c.by_status[s] / c.total : null })}</td></tr>`,
  ).join("");
  const issues = Object.entries(c.input_issues)
    .filter(([, n]) => n)
    .map(([issue, n]) => `${escapeHtml(issue)}: ${n}`)
    .join(", ");
  return `<h2>Coverage</h2>
    <table class="compact"><tr><th>Status</th><th>Samples</th></tr>${rows}</table>
    <p>Evaluated (completed): ${shareText(c.evaluated)}. Capture failures: ${shareText(c.capture_failures)} of captures attempted.
      API errors: ${shareText(c.api_errors)} and refusals: ${shareText(c.refusals)} of samples sent to the judge.
      ${issues ? `Input issues: ${issues}.` : ""}</p>`;
}

function calibrationSection(model: ReportModel) {
  if (!model.calibration) {
    return `<h2>Agreement with human labels</h2><p>No human labels loaded (pass <code>--labels</code>).</p>`;
  }
  const splits = (["development", "holdout"] as const).map((split) => {
    const s = model.calibration![split];
    if (!s.labelled) return `<h3>${split}</h3><p>No labelled ${split} samples.</p>`;
    const rows = DIMENSIONS.map((d) => {
      const a = s.dimensions[d];
      return `<tr><td>${DIMENSION_LABELS[d]}</td><td>${a.n}</td><td>${num(a.mean_absolute_error)}</td><td>${signed(a.bias)}</td>
        <td>${shareText(a.exact)}</td><td>${shareText(a.within_one)}</td>
        <td>${a.categories.exact} / ${a.categories.adjacent} / ${a.categories.over} / ${a.categories.under}</td>
        <td>${idList(a.false_pass)}</td><td>${idList(a.false_fail)}</td>
        <td>${a.excluded.ai_not_answered.length} not answered, ${a.excluded.applicability_mismatch.length} applicability mismatch</td></tr>`;
    }).join("");
    return `<h3>${split} (${s.labelled} labelled samples)</h3>
      <table><tr><th>Dimension</th><th>Pairs</th><th>MAE</th><th>Bias (AI−human)</th><th>Exact</th><th>Within one</th>
      <th>Exact / adjacent / over / under</th><th>Severe failure, high AI score</th><th>Success, low AI score</th><th>Excluded</th></tr>${rows}</table>`;
  });
  return `<h2>Agreement with human labels</h2>
    <p class="note">AI scores are probability-weighted level indices; exact and within-one compare the score rounded to the
      nearest level. Diagnostic bins ${DIAGNOSTIC_BINS.version}: severe failure = human level ${DIAGNOSTIC_BINS.severe_human_level}
      with AI ≥ ${DIAGNOSTIC_BINS.high_ai_score}; success = human level ${DIAGNOSTIC_BINS.success_human_level} with AI ≤
      ${DIAGNOSTIC_BINS.low_ai_score}; over/under = |AI − human| &gt; ${DIAGNOSTIC_BINS.large_error}.
      ${model.unmatchedLabels ? `${model.unmatchedLabels} label(s) didn't match a sample in this run.` : ""}</p>
    ${splits.join("")}`;
}

function reviewerSection(reviewers: Record<Dimension, ReviewerAgreement> | null) {
  if (!reviewers || DIMENSIONS.every((d) => reviewers[d].pairs === 0)) return "";
  const rows = DIMENSIONS.map((d) => {
    const r = reviewers[d];
    return `<tr><td>${DIMENSION_LABELS[d]}</td><td>${r.pairs}</td><td>${shareText(r.exact)}</td><td>${shareText(r.within_one)}</td><td>${r.applicability_mismatches}</td></tr>`;
  }).join("");
  return `<h2>Inter-reviewer agreement</h2>
    <table class="compact"><tr><th>Dimension</th><th>Pairs</th><th>Exact</th><th>Within one</th><th>Applicability mismatches</th></tr>${rows}</table>`;
}

function repeatabilitySection(rep: Record<Dimension, Repeatability>) {
  if (DIMENSIONS.every((d) => rep[d].samples === 0)) {
    return `<h2>Repeatability</h2><p>No repeated trials (use <code>judge --trials N --no-reuse</code> on a fixed subset).</p>`;
  }
  const rows = DIMENSIONS.map((d) => {
    const r = rep[d];
    return `<tr><td>${DIMENSION_LABELS[d]}</td><td>${r.samples}</td><td>${num(r.mean_range)}</td><td>${num(r.max_range)}</td><td>${num(r.mean_sd)}</td><td>${shareText(r.stable_level)}</td></tr>`;
  }).join("");
  return `<h2>Repeatability</h2>
    <table class="compact"><tr><th>Dimension</th><th>Samples</th><th>Mean range</th><th>Max range</th><th>Mean SD</th><th>Same rounded level</th></tr>${rows}</table>`;
}

function comparisonSection(comparison: GeneratorComparison) {
  const rows = comparison.groups.map((g) => {
    const statuses = SAMPLE_STATUSES.filter((s) => g.by_status[s]).map((s) => `${s}: ${g.by_status[s]}`).join(", ");
    const means = DIMENSIONS.map((d) => {
      const m = g.means?.[d];
      return `<td>${m ? `${m.mean.toFixed(2)} <span class="dim">(n=${m.n})</span>` : "—"}</td>`;
    }).join("");
    return `<tr><td><code>${escapeHtml(g.key)}</code></td><td>${g.total}</td><td>${shareText(g.evaluated)}</td><td>${escapeHtml(statuses)}</td>
      <td>${g.families.length}</td>${means}</tr>`;
  }).join("");
  return `<h2>By generator and prompt version</h2>
    ${comparison.comparable ? "" : `<p class="warn">Means hidden: ${escapeHtml(comparison.reason)}. Counts are shown so missing evaluations stay visible.</p>`}
    <table><tr><th>Generator @ prompt version</th><th>Samples</th><th>Evaluated</th><th>Statuses</th><th>Prompt families</th>
      ${DIMENSIONS.map((d) => `<th>${DIMENSION_LABELS[d]} mean</th>`).join("")}</tr>${rows}</table>
    <p class="note">Visual scores are kept separate from deterministic planning-benchmark scores.</p>`;
}

function costSection(model: ReportModel) {
  const { usage, timings } = model;
  const lat = (l: LatencySummary) => (l.n ? `p50 ${l.p50_ms} ms, p95 ${l.p95_ms} ms, max ${l.max_ms} ms (n=${l.n})` : "none in this run");
  return `<h2>Latency and usage</h2>
    <ul>
      <li>Capture latency (fresh captures): ${lat(timings.capture)}</li>
      <li>Judge latency (fresh judgments, including retries): ${lat(timings.judge)}</li>
      <li>Judge requests: ${usage.requests} attempts for ${usage.fresh_judgments} fresh judgments; ${usage.reused_judgments} reused at no cost</li>
      <li>Reported input tokens: ${usage.input_tokens}; estimated cost $${usage.estimated_cost_usd.toFixed(5)}${usage.mock ? " (mock)" : ""}
        ${usage.judgments_without_usage ? `; ${usage.judgments_without_usage} judgment(s) without reported usage (cost estimated)` : ""}</li>
      <li>Generator latency isn't measured: this workflow evaluates saved artifacts.</li>
    </ul>`;
}

function samplesSection(model: ReportModel) {
  const cards = model.results.map((r) => sampleCard(r, model)).join("\n");
  const statusOptions = SAMPLE_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join("");
  return `<h2>Samples</h2>
    <div class="controls">
      <label>Status <select id="f-status"><option value="">all</option>${statusOptions}</select></label>
      <label>Split <select id="f-split"><option value="">all</option><option>development</option><option>holdout</option><option>unassigned</option></select></label>
      <label><input type="checkbox" id="f-disagree"> Large disagreement only</label>
      <label>Sort by <select id="f-sort"><option value="">sample ID</option>
        ${DIMENSIONS.map((d) => `<option value="${d}">${DIMENSION_LABELS[d]} (AI, low first)</option><option value="err-${d}">${DIMENSION_LABELS[d]} |AI−human| (high first)</option>`).join("")}
      </select></label>
      <span id="f-count"></span>
    </div>
    <div id="cards">${cards}</div>`;
}

function sampleCard(r: SampleResult, model: ReportModel) {
  const label = r.human.primary;
  const errors = DIMENSIONS.map((d) => {
    const q = r.scores[d];
    const h = label?.[d];
    return q?.state === "answered" && typeof h === "number" ? Math.abs(q.score - h) : null;
  });
  const disagree = errors.some((e) => e !== null && e > DIAGNOSTIC_BINS.large_error);
  const data = [
    `data-status="${r.status}"`,
    `data-split="${escapeHtml(r.split ?? "")}"`,
    `data-disagree="${disagree}"`,
    ...DIMENSIONS.map((d, i) => {
      const q = r.scores[d];
      return `data-${d}="${q?.state === "answered" ? q.score : ""}" data-err-${d}="${errors[i] ?? ""}"`;
    }),
  ].join(" ");

  const views = r.capture?.views.length
    ? `<div class="views">${r.capture.views
        .map((v) => `<figure><img src="${escapeHtml(model.imagePath(r.sample_id, v.file))}" alt="${escapeHtml(v.label)}" loading="lazy"><figcaption>${escapeHtml(v.label)}</figcaption></figure>`)
        .join("")}</div>`
    : "";

  const scoreRows = DIMENSIONS.map((d) => {
    const humans = r.human.all.map((l) => `${escapeHtml(l.reviewer_id)}: ${escapeHtml(l[d])}`).join("<br>");
    return `<tr><td>${DIMENSION_LABELS[d]}</td><td>${outcomeHtml(r.scores[d])}</td><td>${humans || "—"}</td></tr>`;
  }).join("");

  const trials = r.judgments.length > 1
    ? `<p class="dim">Trials: ${r.judgments.map((j) => `#${j.trial} ${escapeHtml(j.status)}`).join(", ")}</p>`
    : "";
  const notes = r.human.all
    .filter((l) => l.notes)
    .map((l) => `<p class="notes"><b>${escapeHtml(l.reviewer_id)}:</b> ${escapeHtml(l.notes)}</p>`)
    .join("");
  const primary = r.judgments.find((j) => j.trial === 0);
  const provenance = [
    `generator <code>${escapeHtml(r.generator.model_id ?? "unknown")}</code> @ <code>${escapeHtml(r.generator.prompt_version ?? "unknown")}</code>`,
    `source ${escapeHtml(r.provenance_kind ?? "unknown")}`,
    r.player_rating ? `player rating ${escapeHtml(r.player_rating)} (supporting signal only)` : "",
    r.capture ? `capture ${escapeHtml(r.capture.captured_at)}${r.capture.reused_from ? " (reused)" : ""}` : "",
    primary ? `judged ${escapeHtml(primary.evaluated_at)} by ${escapeHtml(primary.response_model ?? primary.judge.model)}${primary.judge.mock ? " (mock)" : ""}${primary.reused_from ? " (reused)" : ""}` : "",
  ].filter(Boolean).join(" · ");

  return `<article class="card" ${data}>
    <header><code>${escapeHtml(r.sample_id)}</code> <span class="status s-${r.status}">${r.status}${r.input_issue ? `: ${escapeHtml(r.input_issue)}` : ""}</span>
      <span class="dim">${escapeHtml(r.split ?? "no split")} · family ${escapeHtml(r.prompt_family_id ?? "—")}</span></header>
    <blockquote>${r.prompt === null ? "<i>no prompt</i>" : escapeHtml(r.prompt)}</blockquote>
    ${views}
    <table class="scores"><tr><th>Dimension</th><th>AI (score · confidence · level probabilities)</th><th>Human</th></tr>${scoreRows}</table>
    ${r.reasons.length ? `<ul class="reasons">${r.reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    ${notes}${trials}
    <p class="dim">${provenance}</p>
  </article>`;
}

function outcomeHtml(q: QuestionOutcome | null) {
  if (!q) return `<span class="dim">not judged</span>`;
  switch (q.state) {
    case "answered": {
      const bars = q.probabilities
        .map((p) => `<span class="bar" title="${escapeHtml(`${p.value}: ${p.label} — ${(p.probability * 100).toFixed(1)}%`)}" style="width:${(p.probability * 100).toFixed(1)}%"></span>`)
        .join("");
      return `<b>${q.score.toFixed(2)}</b> · ${q.confidence.toFixed(2)} <span class="dist">${bars}</span>`;
    }
    case "invalid":
      return `<span class="warn">invalid: ${escapeHtml(q.reason)}</span>`;
    default:
      return `<span class="dim">${q.state.replace("_", " ")}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Blind labelling view: prompt and views only. No sample IDs, statuses,
// generator identity or AI scores.

export interface BlindItem {
  blind_id: string;
  prompt: string;
  views: Array<{ label: string; src: string }>;
}

export function blindHtml(items: BlindItem[], rubric: Rubric): string {
  const legend = rubric.questions
    .map(
      (q) => `<details><summary>${escapeHtml(DIMENSION_LABELS[q.name])}</summary><p>${escapeHtml(q.instructions)}</p>
        <ol start="0">${q.levels.map((l) => `<li><b>${escapeHtml(l.label)}</b>: ${escapeHtml(l.description)}</li>`).join("")}</ol></details>`,
    )
    .join("");
  const cards = items
    .map((item) => {
      const fields = rubric.questions
        .map((q) => {
          const options = q.levels
            .map((l, i) => `<label title="${escapeHtml(l.label)}"><input type="radio" name="${escapeHtml(item.blind_id)}-${q.name}" value="${i}"> ${i}</label>`)
            .join(" ");
          const na = q.applies_to === "all"
            ? ""
            : `<label><input type="radio" name="${escapeHtml(item.blind_id)}-${q.name}" value="not_applicable"> n/a (no explicit visual attributes)</label>`;
          return `<p><span class="field">${escapeHtml(DIMENSION_LABELS[q.name])}</span> ${options} ${na}</p>`;
        })
        .join("");
      return `<article class="card" data-blind-id="${escapeHtml(item.blind_id)}">
        <header><code>${escapeHtml(item.blind_id)}</code></header>
        <blockquote>${escapeHtml(item.prompt)}</blockquote>
        <div class="views">${item.views.map((v) => `<figure><img src="${escapeHtml(v.src)}" alt="${escapeHtml(v.label)}" loading="lazy"><figcaption>${escapeHtml(v.label)}</figcaption></figure>`).join("")}</div>
        <form>${fields}<p><textarea name="notes" rows="2" placeholder="Notes (optional): what is wrong or right?"></textarea></p></form>
      </article>`;
    })
    .join("\n");
  const body = `<h1>Blind labelling</h1>
    <p class="note">Score what you see against the player's request. Generator identity and AI scores are hidden on purpose.
      ${escapeHtml(SCALE_DISCLAIMER)}</p>
    <div class="legend">${legend}</div>
    <div class="controls"><label>Reviewer ID <input id="reviewer" required></label>
      <button id="download" type="button">Download labels JSON</button> <span id="status"></span></div>
    <div id="cards">${cards}</div>`;
  return page("Blind labelling", body, blindScript(rubric));
}

function blindScript(rubric: Rubric) {
  // Rubric data is embedded as JSON with "<" escaped so it can't close the tag.
  const config = JSON.stringify({
    rubric_version: rubric.version,
    questions: rubric.questions.map((q) => ({ name: q.name, optional: q.applies_to !== "all" })),
  }).replace(/</g, "\\u003c");
  return `
const config = ${config};
document.getElementById("download").addEventListener("click", () => {
  const reviewer = document.getElementById("reviewer").value.trim();
  const status = document.getElementById("status");
  if (!reviewer) { status.textContent = "Enter a reviewer ID first."; return; }
  const labels = [];
  let incomplete = 0;
  for (const card of document.querySelectorAll("article[data-blind-id]")) {
    const id = card.dataset.blindId;
    const label = { blind_id: id, reviewer_id: reviewer };
    let filled = 0;
    for (const q of config.questions) {
      const checked = card.querySelector('input[name="' + CSS.escape(id + "-" + q.name) + '"]:checked');
      if (checked) { label[q.name] = checked.value === "not_applicable" ? "not_applicable" : Number(checked.value); filled += 1; }
    }
    if (filled === 0) continue;
    if (filled < config.questions.length) { incomplete += 1; continue; }
    const notes = card.querySelector("textarea").value.trim();
    if (notes) label.notes = notes;
    labels.push(label);
  }
  const file = { format: "vq-labels/v1", rubric_version: config.rubric_version, labels };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "labels-" + reviewer.replace(/[^a-z0-9_-]/gi, "_") + ".json";
  link.click();
  URL.revokeObjectURL(url);
  status.textContent = labels.length + " labelled" + (incomplete ? ", " + incomplete + " partially filled (skipped)" : "") + ".";
});`;
}

const FILTER_SCRIPT = `
const cards = [...document.querySelectorAll("#cards > article")];
const controls = ["f-status", "f-split", "f-disagree", "f-sort"].map((id) => document.getElementById(id));
function apply() {
  const [status, split, disagree, sort] = controls;
  let shown = 0;
  for (const card of cards) {
    const visible = (!status.value || card.dataset.status === status.value)
      && (!split.value || card.dataset.split === split.value)
      && (!disagree.checked || card.dataset.disagree === "true");
    card.hidden = !visible;
    if (visible) shown += 1;
  }
  const key = sort.value;
  const order = [...cards];
  if (key) {
    // dataset camel-cases hyphens only: data-err-x_y -> errX_y.
    const attr = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = (card) => card.dataset[attr] === "" ? null : Number(card.dataset[attr]);
    const descending = key.startsWith("err-");
    order.sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return descending ? y - x : x - y;
    });
  }
  const container = document.getElementById("cards");
  for (const card of order) container.appendChild(card);
  document.getElementById("f-count").textContent = shown + " of " + cards.length + " samples";
}
for (const control of controls) control.addEventListener("change", apply);
apply();`;

function page(title: string, body: string, script: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; margin: 24px; color: #1d2329; background: #f6f7f9; }
  h1 { font-size: 22px; } h2 { margin-top: 32px; border-bottom: 1px solid #d5dae0; } h3 { font-size: 15px; }
  table { border-collapse: collapse; margin: 8px 0; background: #fff; }
  th, td { border: 1px solid #d5dae0; padding: 4px 8px; text-align: left; vertical-align: top; }
  table.compact td, table.compact th { padding: 2px 8px; }
  code { font-size: 12px; }
  .meta, .dim { color: #5b6672; } .dim { font-size: 12px; }
  .note { background: #eef2f6; padding: 8px 12px; border-radius: 6px; }
  .banner { background: #fff1c2; border: 1px solid #e0b400; padding: 8px 12px; font-weight: 600; }
  .warn { color: #a43c00; }
  .controls { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
  .card { background: #fff; border: 1px solid #d5dae0; border-radius: 8px; padding: 12px; margin: 12px 0; }
  .card header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  blockquote { margin: 8px 0; padding: 6px 10px; border-left: 3px solid #8796a8; background: #f1f3f6; white-space: pre-wrap; }
  .views { display: flex; gap: 8px; flex-wrap: wrap; }
  figure { margin: 0; } figure img { width: 240px; height: 240px; border-radius: 4px; display: block; }
  figcaption { font-size: 12px; color: #5b6672; }
  .status { font-size: 12px; padding: 1px 6px; border-radius: 4px; background: #e2e6ea; }
  .s-completed { background: #d3f2dc; } .s-incomplete, .s-refused { background: #fff1c2; }
  .s-api_error, .s-capture_failed { background: #ffd9d2; } .s-input_invalid { background: #e6dcf5; }
  .dist { display: inline-flex; width: 120px; height: 8px; vertical-align: middle; background: #eef0f3; }
  .bar { display: inline-block; height: 8px; border-right: 1px solid #fff; background: #4d7cc7; }
  .bar:nth-child(1) { background: #c2453b; } .bar:nth-child(2) { background: #e09a3c; } .bar:nth-child(3) { background: #8fb84f; } .bar:nth-child(4) { background: #3f9b5b; }
  .reasons { color: #a43c00; font-size: 12px; } .notes { font-size: 13px; }
  .field { display: inline-block; width: 140px; font-weight: 600; }
  .legend details { margin: 4px 0; } textarea { width: 100%; max-width: 720px; }
</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>
`;
}

function shareText(s: Share) {
  return s.of ? `${s.count}/${s.of} (${((s.rate ?? 0) * 100).toFixed(0)}%)` : `${s.count}/0`;
}

function num(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

function signed(value: number | null) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function idList(ids: string[]) {
  return ids.length ? `${ids.length}: ${ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")}` : "0";
}
