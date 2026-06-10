import { describe, expect, it, vi } from "vitest";

import { createFixtureAiWorkerClient } from "@/core";
import {
  createBackendLifecycleCommands,
  type PendingObjectFeedback,
} from "@/backend/createBackendLifecycleCommands";
import type {
  BackendPresenceBridge,
  BackendPresenceSnapshot,
  BackendRequestCreateObjectInput,
} from "@/backend/createBackendPresenceBridge";
import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";

// A minimal fake bridge that records the create-path reducer calls. submitPrompt only
// touches requestCreateObject / submitAiDraft / releaseObject, so the rest reject loudly
// if the flow ever reaches them unexpectedly.
function fakeBridge(snapshot: BackendPresenceSnapshot = readySnapshot()) {
  const createCalls: BackendRequestCreateObjectInput[] = [];
  const bridge = {
    getSnapshot: vi.fn(() => snapshot),
    requestCreateObject: vi.fn(async (input: BackendRequestCreateObjectInput) => {
      createCalls.push(input);
    }),
    submitAiDraft: vi.fn(async () => {}),
    updateDraftTransform: vi.fn(async () => {}),
    releaseObject: vi.fn(async () => {}),
  } as unknown as BackendPresenceBridge;
  return { bridge, createCalls };
}

describe("createBackendLifecycleCommands avatar editing", () => {
  it("generates a fresh body and persists it via setAvatarSpec when none exists", async () => {
    const snapshot = readySnapshot();
    const setAvatarSpec =
      vi.fn<(input: { voxelCoreJson: string; builderSpecJson: string }) => Promise<void>>(
        async () => {},
      );
    const bridge = {
      getSnapshot: vi.fn(() => snapshot),
      setAvatarSpec,
    } as unknown as BackendPresenceBridge;
    const commands = createBackendLifecycleCommands(
      bridge,
      createFixtureAiWorkerClient(),
    );

    await commands.editAvatar("a red robot with a crown");

    expect(setAvatarSpec).toHaveBeenCalledTimes(1);
    const input = setAvatarSpec.mock.calls[0][0];
    expect(() => JSON.parse(input.voxelCoreJson)).not.toThrow();
    expect(() => JSON.parse(input.builderSpecJson)).not.toThrow();
  });

  it("feeds the current body to createEdit when one already exists", async () => {
    const fixture = createFixtureAiWorkerClient();
    const draft = await fixture.createDraft({ prompt: "guardian avatar" });
    const snapshot = readySnapshot();
    snapshot.avatars = [
      {
        id: "local_player",
        voxelCoreJson: draft.sourceSpecJson,
        builderSpecJson: draft.builderSpecJson,
        version: 2,
      },
    ];
    const setAvatarSpec = vi.fn(async () => {});
    const createEdit = vi.fn<
      (input: { baseVersion: number; purpose?: string }) => Promise<unknown>
    >(
      async () => ({
        sourceSpec: draft.sourceSpec,
        builderSpec: draft.builderSpec,
        sourceSpecJson: draft.sourceSpecJson,
        builderSpecJson: draft.builderSpecJson,
        modelId: "fixture",
      }),
    );
    const bridge = {
      getSnapshot: vi.fn(() => snapshot),
      setAvatarSpec,
    } as unknown as BackendPresenceBridge;
    const commands = createBackendLifecycleCommands(bridge, {
      createDraft: vi.fn(),
      createEdit,
    } as never);

    await commands.editAvatar("give it a crown");

    expect(createEdit).toHaveBeenCalledTimes(1);
    const editArg = createEdit.mock.calls[0][0];
    expect(editArg.baseVersion).toBe(2);
    // Avatar edits must use the avatar system prompt, not the generic object one.
    expect(editArg.purpose).toBe("avatar");
    expect(setAvatarSpec).toHaveBeenCalledTimes(1);
  });

  it("rejects a blank avatar prompt", async () => {
    const snapshot = readySnapshot();
    const bridge = {
      getSnapshot: vi.fn(() => snapshot),
      setAvatarSpec: vi.fn(async () => {}),
    } as unknown as BackendPresenceBridge;
    const commands = createBackendLifecycleCommands(
      bridge,
      createFixtureAiWorkerClient(),
    );
    await expect(commands.editAvatar("   ")).rejects.toThrow();
  });
});

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
      promptVersion: "v3",
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

  it("duplicates a selected public object from the backend snapshot without calling AI", async () => {
    const fixture = createFixtureAiWorkerClient();
    const draft = await fixture.createDraft({ prompt: "a pine tree" });
    const object: AuthorityWorld["objects"][number] = {
      object_id: "original_tree",
      world_id: "1",
      state: "public",
      version: 1,
      created_by: "other_player",
      latest_editor: "other_player",
      grace_owner_id: null,
      lock_owner_id: null,
      builder_spec: draft.builderSpec,
      transform: {
        position: [1, 0, 2],
        rotation: [0, 0.5, 0],
        scale: [1.2, 1.2, 1.2],
      },
      cooldown_remaining_seconds: 0,
      grace_remaining_seconds: 0,
    };
    const snapshot = readySnapshot({
      objects: [object],
      artifacts: [
        {
          objectId: object.object_id,
          state: object.state,
          version: object.version,
          sourceSpecJson: draft.sourceSpecJson,
          builderSpecJson: draft.builderSpecJson,
        },
      ],
    });
    const { bridge, createCalls } = fakeBridge(snapshot);
    const aiWorker = {
      createDraft: vi.fn(),
      createEdit: vi.fn(),
    };
    const commands = createBackendLifecycleCommands(
      bridge,
      aiWorker as never,
      { getSelectedObjectId: () => object.object_id },
    );

    expect(commands.canCopySelectedObject()).toBe(true);
    const template = commands.copySelectedObject();
    const newObjectId = await commands.pasteCopiedObject(template, {
      x: 3.5,
      y: 0,
      z: 2,
    });

    expect(newObjectId).toMatch(/^avatar_copy_/);
    expect(aiWorker.createDraft).not.toHaveBeenCalled();
    expect(aiWorker.createEdit).not.toHaveBeenCalled();
    expect(createCalls[0]).toMatchObject({
      jobId: expect.stringMatching(/^backend_duplicate_/),
      sourcePrompt: "duplicate avatar",
    });
    expect(bridge.submitAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: newObjectId,
        sourceSpecJson: draft.sourceSpecJson,
        builderSpecJson: draft.builderSpecJson,
        positionX: 3.5,
        positionY: 0,
        positionZ: 2,
      }),
    );
    expect(bridge.updateDraftTransform).toHaveBeenCalledWith({
      objectId: newObjectId,
      positionX: 3.5,
      positionY: 0,
      positionZ: 2,
      rotationX: 0,
      rotationY: 0.5,
      rotationZ: 0,
      scaleX: 1.2,
      scaleY: 1.2,
      scaleZ: 1.2,
    });
  });

  it("releases an owned grace selection before pasting another duplicate", async () => {
    const fixture = createFixtureAiWorkerClient();
    const draft = await fixture.createDraft({ prompt: "a pine tree" });
    const object: AuthorityWorld["objects"][number] = {
      object_id: "previous_copy",
      world_id: "1",
      state: "grace",
      version: 1,
      created_by: "local_player",
      latest_editor: "local_player",
      grace_owner_id: "local_player",
      lock_owner_id: null,
      builder_spec: draft.builderSpec,
      transform: {
        position: [1, 0, 2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      cooldown_remaining_seconds: 0,
      grace_remaining_seconds: 30,
    };
    const { bridge } = fakeBridge(
      readySnapshot({ objects: [object] }),
    );
    const commands = createBackendLifecycleCommands(
      bridge,
      createFixtureAiWorkerClient(),
      { getSelectedObjectId: () => object.object_id },
    );

    await commands.releaseSelectedObjectForPaste();

    expect(bridge.releaseObject).toHaveBeenCalledWith({
      objectId: object.object_id,
    });
  });
});

function readySnapshot({
  objects = [],
  artifacts = [],
}: {
  objects?: AuthorityWorld["objects"];
  artifacts?: BackendPresenceSnapshot["objectArtifacts"];
} = {}): BackendPresenceSnapshot {
  return {
    enabled: true,
    status: "connected",
    message: "Live room joined.",
    nickname: "Alice",
    onlineCount: 1,
    world: {
      id: "1",
      name: "Test",
      visibility: "public",
      maxPlayers: 20,
      maxLiveObjects: 100,
      maxObjectsPerPlayer: 40,
      maxPendingCreateJobsPerPlayer: 4,
      destructiveEditsEnabled: true,
      objectCooldownSeconds: 0,
      gracePeriodSeconds: 30,
    },
    players: [
      {
        id: "local_player",
        nickname: "Alice",
        role: "player",
        presenceState: "active",
        transform: {
          positionX: 0,
          positionY: 0,
          positionZ: 0,
          rotationYaw: 0,
          rotationPitch: 0,
        },
        isLocal: true,
      },
    ],
    avatars: [],
    authorityWorld: {
      world_id: "1",
      settings: {
        visibility: "public",
        destructive_edits_enabled: true,
        object_cooldown_seconds: 0,
        protected_spawn_enabled: true,
      },
      jobs: [],
      objects,
      events: [],
    },
    archiveAuthorityWorld: null,
    objectArtifacts: artifacts,
    aiJobs: [],
    worldSnapshots: [],
    snapshotObjects: [],
    chatMessages: [],
  };
}
