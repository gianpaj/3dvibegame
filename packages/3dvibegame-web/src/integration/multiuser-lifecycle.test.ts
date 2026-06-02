import { describe, expect, it } from "vitest";
import {
  createAuthorityWorld,
  expireCooldown,
  releaseEditLock,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  submitObjectEdit,
  updateLockedTransform,
  type AuthorityWorld,
  type BuilderSpec,
} from "@3dvibegame/scene-authority-ts";

import { createBrowserGeminiAiWorkerClient } from "@/core/aiWorker/browserGeminiAiWorkerClient";
import { geminiResponse, redTreeCore, treeCore } from "@/test/fakeGemini";

// End-to-end authority lifecycle across two users, with AI artifacts from the mocked
// browser client. Uses the canonical pure reducers in @3dvibegame/scene-authority-ts
// (the shared source of authority truth) — no SpacetimeDB, no Gemini key, no network.
//
// NOTE: the deployed multiplayer backend is the separate SpacetimeDB module
// (`world-backend`), covered by the `spacetime` smoke harness. This test exercises the
// shared authority logic + AI plumbing, not the live network path.

const ALICE = "player_alice";
const BOB = "player_bob";
const OBJECT_ID = "pine_tree_obj";

function aiClient(core: typeof treeCore) {
  const fetchImpl = (async () => geminiResponse(core)) as unknown as typeof fetch;
  return createBrowserGeminiAiWorkerClient({ apiKey: () => "k", fetchImpl });
}

function objectOf(world: AuthorityWorld) {
  const object = world.objects.find((candidate) => candidate.object_id === OBJECT_ID);
  if (!object) throw new Error("object missing");
  return object;
}

describe("multi-user object lifecycle (create → move → edit)", () => {
  it("alice creates, bob moves and edits it", async () => {
    let world = createAuthorityWorld({
      worldId: "test_world",
      settings: {
        visibility: "private",
        destructive_edits_enabled: true,
        object_cooldown_seconds: 0,
        protected_spawn_enabled: false,
      },
    });

    // --- Alice creates an object via (mocked) Gemini ---
    const draft = await aiClient(treeCore).createDraft({ prompt: "a pine tree" });
    world = requestCreateObject(world, {
      jobId: "job_1",
      playerId: ALICE,
      sourcePrompt: "a pine tree",
    }).world;
    world = submitAIDraft(world, {
      jobId: "job_1",
      objectId: OBJECT_ID,
      creatorId: ALICE,
      builderSpec: draft.builderSpec as BuilderSpec,
      graceSeconds: 30,
    }).world;
    expect(objectOf(world).state).toBe("grace");

    world = releaseObject(world, { objectId: OBJECT_ID, playerId: ALICE }).world;
    expect(objectOf(world).state).toBe("public");
    expect(objectOf(world).version).toBe(1);

    // --- Bob takes the lock and moves it; alice cannot move it meanwhile ---
    world = requestEditLock(world, { objectId: OBJECT_ID, playerId: BOB, baseVersion: 1 }).world;
    expect(objectOf(world).state).toBe("edit_locked");
    expect(objectOf(world).lock_owner_id).toBe(BOB);

    const lockedWorld = world;
    expect(() =>
      updateLockedTransform(lockedWorld, {
        objectId: OBJECT_ID,
        playerId: ALICE,
        patch: { position: { x: 9 } },
      }),
    ).toThrow(/lock owner/i);

    const startX = objectOf(world).transform.position[0];
    world = updateLockedTransform(world, {
      objectId: OBJECT_ID,
      playerId: BOB,
      patch: { position: { x: startX + 2.5 } },
    }).world;
    world = releaseEditLock(world, { objectId: OBJECT_ID, playerId: BOB }).world;
    expect(objectOf(world).transform.position[0]).toBeCloseTo(startX + 2.5);
    expect(objectOf(world).state).toBe("public");
    // Publishing the move bumps the version (1 → 2) and records the editor.
    expect(objectOf(world).version).toBe(2);
    expect(objectOf(world).latest_editor).toBe(BOB);

    // --- Bob edits it via (mocked) Gemini → new version, recolored ---
    const edit = await aiClient(redTreeCore).createEdit({
      baseObjectId: OBJECT_ID,
      baseVersion: 2,
      sourcePrompt: "make it red",
      objectContext: {
        objectId: OBJECT_ID,
        version: 2,
        sourceSpecJson: draft.sourceSpecJson,
        builderSpecJson: draft.builderSpecJson,
      },
    });

    world = requestEditLock(world, { objectId: OBJECT_ID, playerId: BOB, baseVersion: 2 }).world;
    world = submitObjectEdit(world, {
      objectId: OBJECT_ID,
      playerId: BOB,
      baseVersion: 2,
      builderSpec: edit.builderSpec as BuilderSpec,
    }).world;
    world = expireCooldown(world, { objectId: OBJECT_ID }).world;

    const finalObject = objectOf(world);
    expect(finalObject.state).toBe("public");
    expect(finalObject.version).toBe(3);
    expect(finalObject.latest_editor).toBe(BOB);
    expect(finalObject.builder_spec.parts.map((part) => part.material)).toContain("red");
  });

  it("rejects a stale edit (wrong base version)", async () => {
    let world = createAuthorityWorld({
      worldId: "test_world_2",
      settings: {
        visibility: "private",
        destructive_edits_enabled: true,
        object_cooldown_seconds: 0,
        protected_spawn_enabled: false,
      },
    });
    const draft = await aiClient(treeCore).createDraft({ prompt: "a pine tree" });
    world = requestCreateObject(world, { jobId: "j", playerId: ALICE, sourcePrompt: "p" }).world;
    world = submitAIDraft(world, {
      jobId: "j",
      objectId: OBJECT_ID,
      creatorId: ALICE,
      builderSpec: draft.builderSpec as BuilderSpec,
    }).world;
    world = releaseObject(world, { objectId: OBJECT_ID, playerId: ALICE }).world;
    world = requestEditLock(world, { objectId: OBJECT_ID, playerId: BOB, baseVersion: 1 }).world;

    expect(() =>
      submitObjectEdit(world, {
        objectId: OBJECT_ID,
        playerId: BOB,
        baseVersion: 0, // stale
        builderSpec: draft.builderSpec as BuilderSpec,
      }),
    ).toThrow(/stale object version/i);
  });
});
