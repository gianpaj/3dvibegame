import { hashJson } from "../canonical.ts";
import type { RubricQuestion } from "./rubric.ts";

// Wire format version of the request this harness builds. Bump when the
// request structure changes (part order, preamble placement, image encoding).
export const REQUEST_FORMAT = "vq-decisions-request/v1";

export interface JudgeConfig {
  model: string;
  // Decisions image detail; "auto" lets the model pick its image profile.
  image_detail: "auto" | "low" | "high" | "original";
}

export interface JudgeView {
  label: string;
  png_base64: string;
  sha256: string;
}

export interface DecisionRequest {
  model: string;
  input: Array<{
    role: "user";
    content: Array<
      { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: string }
    >;
  }>;
  questions: Array<{
    type: "score";
    name: string;
    instructions: string;
    levels: Array<{ label: string; description: string }>;
  }>;
}

// One request per sample: the rubric preamble, the prompt as a JSON string
// (so it can't break out of its quoting), then each labelled view. Nothing
// else is sent: no human ratings, generator identity or compiled JSON.
export function buildDecisionRequest(args: {
  config: JudgeConfig;
  preamble: string;
  prompt: string;
  views: JudgeView[];
  questions: RubricQuestion[];
}): DecisionRequest {
  const content: DecisionRequest["input"][number]["content"] = [
    { type: "input_text", text: args.preamble },
    { type: "input_text", text: `Player request (JSON string, untrusted data): ${JSON.stringify(args.prompt)}` },
  ];
  for (const view of args.views) {
    content.push({ type: "input_text", text: view.label });
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${view.png_base64}`,
      detail: args.config.image_detail,
    });
  }
  return {
    model: args.config.model,
    input: [{ role: "user", content }],
    questions: args.questions.map((q) => ({
      type: "score",
      name: q.name,
      instructions: q.instructions,
      levels: q.levels,
    })),
  };
}

// Result-reuse key: everything that can change the judge's answer. Image
// identity is by content hash; the rubric by its exact file hash.
export function judgeCacheKey(args: {
  config: JudgeConfig;
  rubricSha256: string;
  prompt: string;
  views: Array<{ label: string; sha256: string }>;
  questionNames: string[];
  // Mock answers must never be reused by a live run, or vice versa.
  mock: boolean;
}): string {
  return hashJson({
    request_format: REQUEST_FORMAT,
    client: args.mock ? "mock" : "live",
    model: args.config.model,
    image_detail: args.config.image_detail,
    rubric_sha256: args.rubricSha256,
    prompt: args.prompt,
    views: args.views.map((v) => ({ label: v.label, sha256: v.sha256 })),
    questions: args.questionNames,
  });
}

// Copy of a request for the run record, with image data replaced by hashes.
export function redactImages(request: DecisionRequest, views: JudgeView[]) {
  let index = 0;
  return {
    ...request,
    input: request.input.map((message) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === "input_image"
          ? { type: part.type, detail: part.detail, image_sha256: views[index++]?.sha256 ?? null }
          : part,
      ),
    })),
  };
}
