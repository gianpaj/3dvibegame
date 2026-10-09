import {
  DIMENSIONS,
  type Dimension,
  type JudgeStatus,
  type QuestionOutcome,
  type ScoreProbability,
  type Usage,
} from "../contracts.ts";
import { isDimension, type RubricQuestion } from "./rubric.ts";

const PROBABILITY_SUM_TOLERANCE = 0.02;
const SCORE_CONSISTENCY_TOLERANCE = 0.05;

export interface ValidatedResponse {
  status: Exclude<JudgeStatus, "api_error">;
  questions: Record<Dimension, QuestionOutcome>;
  usage: Usage | null;
  model: string | null;
  // Response-level problems (unexpected or duplicate answers) that don't
  // belong to one applicable question.
  problems: string[];
}

// Validates a Decisions response against the questions that were asked. Each
// question is judged on its own, so a bad answer to one question doesn't
// discard valid answers to the others.
export function validateDecisionResponse(body: unknown, asked: RubricQuestion[]): ValidatedResponse | { error: string } {
  if (!isRecord(body) || !Array.isArray(body.answers)) {
    return { error: "response has no answers array" };
  }

  const questions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, { state: "not_applicable" } as QuestionOutcome]),
  ) as Record<Dimension, QuestionOutcome>;
  const askedByName = new Map(asked.map((q) => [q.name as string, q]));
  for (const q of asked) questions[q.name] = { state: "missing" };

  const problems: string[] = [];
  const seen = new Set<string>();
  body.answers.forEach((answer, index) => {
    const name = isRecord(answer) ? answer.name : undefined;
    if (typeof name !== "string" || !askedByName.has(name) || !isDimension(name)) {
      problems.push(`answers[${index}] has unexpected name ${JSON.stringify(name ?? null)}`);
      return;
    }
    if (seen.has(name)) {
      questions[name] = { state: "invalid", reason: "question answered more than once" };
      problems.push(`duplicate answer for ${name}`);
      return;
    }
    seen.add(name);
    questions[name] = validateAnswer(answer as Record<string, unknown>, askedByName.get(name)!);
  });

  const outcomes = asked.map((q) => questions[q.name]);
  const status: ValidatedResponse["status"] = outcomes.every((o) => o.state === "answered")
    ? "completed"
    : outcomes.every((o) => o.state === "answered" || o.state === "refused")
      ? "refused"
      : "incomplete";

  return {
    status,
    questions,
    usage: parseUsage(body.usage),
    model: typeof body.model === "string" ? body.model : null,
    problems,
  };
}

function validateAnswer(answer: Record<string, unknown>, question: RubricQuestion): QuestionOutcome {
  if (answer.type === "refusal") return { state: "refused" };
  if (answer.type !== "score") {
    return { state: "invalid", reason: `expected a score answer, got ${JSON.stringify(answer.type ?? null)}` };
  }

  const maxIndex = question.levels.length - 1;
  const { score, confidence, probabilities } = answer;
  if (!isFiniteNumber(score) || score < 0 || score > maxIndex) {
    return { state: "invalid", reason: `score ${JSON.stringify(score)} outside 0-${maxIndex}` };
  }
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) {
    return { state: "invalid", reason: `confidence ${JSON.stringify(confidence)} outside 0-1` };
  }
  if (!Array.isArray(probabilities) || probabilities.length !== question.levels.length) {
    return { state: "invalid", reason: `expected ${question.levels.length} level probabilities` };
  }

  const parsed: ScoreProbability[] = [];
  for (const entry of probabilities) {
    if (!isRecord(entry) || !Number.isInteger(entry.value) || !isFiniteNumber(entry.probability)) {
      return { state: "invalid", reason: "malformed level probability" };
    }
    const value = entry.value as number;
    const level = question.levels[value];
    if (!level || parsed.some((p) => p.value === value)) {
      return { state: "invalid", reason: `unexpected or repeated level index ${value}` };
    }
    if (entry.label !== undefined && entry.label !== level.label) {
      return { state: "invalid", reason: `level ${value} label does not match the rubric` };
    }
    if (entry.probability < 0 || entry.probability > 1) {
      return { state: "invalid", reason: `level ${value} probability outside 0-1` };
    }
    parsed.push({ value, label: level.label, probability: entry.probability });
  }
  parsed.sort((a, b) => a.value - b.value);

  const total = parsed.reduce((sum, p) => sum + p.probability, 0);
  if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) {
    return { state: "invalid", reason: `level probabilities sum to ${total.toFixed(3)}` };
  }
  const expected = parsed.reduce((sum, p) => sum + p.value * p.probability, 0) / total;
  if (Math.abs(expected - score) > SCORE_CONSISTENCY_TOLERANCE) {
    return { state: "invalid", reason: `score ${score} disagrees with its probabilities (${expected.toFixed(3)})` };
  }

  return { state: "answered", score, confidence, probabilities: parsed };
}

function parseUsage(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  const { input_tokens, output_tokens, total_tokens } = value;
  if (!isFiniteNumber(input_tokens) || input_tokens < 0) return null;
  return {
    input_tokens,
    output_tokens: isFiniteNumber(output_tokens) ? output_tokens : 0,
    total_tokens: isFiniteNumber(total_tokens) ? total_tokens : input_tokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
