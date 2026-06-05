import { describe, expect, it, vi } from "vitest";

import { createFixtureAiWorkerClient } from "@/core";
import {
  createBackendLifecycleCommands,
  type PendingObjectFeedback,
} from "@/backend/createBackendLifecycleCommands";
import type {
  BackendPresenceBridge,
  BackendRequestCreateObjectInput,
} from "@/backend/createBackendPresenceBridge";

// A minimal fake bridge that records the create-path reducer calls. submitPrompt only
// touches requestCreateObject / submitAiDraft / releaseObject, so the rest reject loudly
// if the flow ever reaches them unexpectedly.
function fakeBridge() {
  const createCalls: BackendRequestCreateObjectInput[] = [];
  const bridge = {
    requestCreateObject: vi.fn(async (input: BackendRequestCreateObjectInput) => {
      createCalls.push(input);
    }),
    submitAiDraft: vi.fn(async () => {}),
    releaseObject: vi.fn(async () => {}),
  } as unknown as BackendPresenceBridge;
  return { bridge, createCalls };
}

describe("createBackendLifecycleCommands feedback provenance", () => {
  it("fires onOperation with the create snapshot after a successful prompt", async () => {
    const { bridge, createCalls } = fakeBridge();
    const onOperation = vi.fn<(feedback: PendingObjectFeedback) => void>();
    const commands = createBackendLifecycleCommands(
      bridge,
      createFixtureAiWorkerClient(),
      { onOperation },
    );

    await commands.submitPrompt("a pine tree");

    expect(onOperation).toHaveBeenCalledTimes(1);
    const feedback = onOperation.mock.calls[0][0];

    // The dedupe key is the create job's id — the same id we minted for the reducer.
    expect(createCalls).toHaveLength(1);
    expect(feedback.operationId).toBe(createCalls[0].jobId);
    expect(feedback.operationId).toMatch(/^backend_create_/);

    expect(feedback).toMatchObject({
      operation: "create",
      objectVersion: 1,
      sourcePrompt: "a pine tree",
      modelId: "fixture",
      promptVersion: "v1",
    });
    // The spec JSONs are forwarded verbatim from the AI draft (parseable, non-empty).
    expect(() => JSON.parse(feedback.sourceSpecJson)).not.toThrow();
    expect(() => JSON.parse(feedback.builderSpecJson)).not.toThrow();
  });

  it("does not fire onOperation when the prompt is blank", async () => {
    const { bridge } = fakeBridge();
    const onOperation = vi.fn();
    const commands = createBackendLifecycleCommands(
      bridge,
      createFixtureAiWorkerClient(),
      { onOperation },
    );

    await expect(commands.submitPrompt("   ")).rejects.toThrow();
    expect(onOperation).not.toHaveBeenCalled();
  });
});
