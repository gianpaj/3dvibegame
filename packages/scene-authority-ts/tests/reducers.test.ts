import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthorityWorld,
  deleteObject,
  expireCooldown,
  releaseEditLock,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  submitObjectEdit,
  updateLockedTransform,
} from "../src/reducers.ts";
import type { AuthorityWorld, BuilderSpec } from "../src/contracts.ts";

const creatorId = "player_creator";
const editorId = "player_editor";
const objectId = "object_1";

test("create request, AI draft, and release move an object through grace into public", () => {
  const world = createDraftWorld();

  assert.equal(world.jobs[0]?.status, "completed");
  const object = requireObject(world);
  assert.equal(object.state, "grace");
  assert.equal(object.version, 1);
  assert.equal(object.grace_owner_id, creatorId);
  assert.equal(object.builder_spec.object_category, "tree");

  const released = releaseObject(world, {
    objectId,
    playerId: creatorId,
  });

  assert.equal(released.event.kind, "release_object");
  const releasedObject = requireObject(released.world);
  assert.equal(releasedObject.state, "public");
  assert.equal(releasedObject.grace_owner_id, null);
  assert.equal(releasedObject.grace_remaining_seconds, 0);
});

test("edit locks enforce ownership and can publish transform changes", () => {
  let world = createReleasedWorld();

  const locked = requestEditLock(world, {
    objectId,
    playerId: editorId,
    baseVersion: 1,
  });
  world = locked.world;

  const lockedObject = requireObject(world);
  assert.equal(locked.event.kind, "request_edit_lock");
  assert.equal(lockedObject.state, "edit_locked");
  assert.equal(lockedObject.lock_owner_id, editorId);

  assert.throws(
    () =>
      updateLockedTransform(world, {
        objectId,
        playerId: creatorId,
        patch: { position: { x: 4 } },
      }),
    /only the lock owner/,
  );

  world = updateLockedTransform(world, {
    objectId,
    playerId: editorId,
    patch: { position: { x: 4 } },
  }).world;

  const released = releaseEditLock(world, {
    objectId,
    playerId: editorId,
  });

  const releasedObject = requireObject(released.world);
  assert.equal(released.event.kind, "release_edit_lock");
  assert.equal(releasedObject.state, "public");
  assert.equal(releasedObject.lock_owner_id, null);
  assert.equal(releasedObject.latest_editor, editorId);
  assert.equal(releasedObject.version, 2);
  assert.deepEqual(releasedObject.transform.position, [4, 0, 0]);
});

test("stale versions are rejected for edit locks and edit submits", () => {
  let world = createReleasedWorld();

  assert.throws(
    () =>
      requestEditLock(world, {
        objectId,
        playerId: editorId,
        baseVersion: 0,
      }),
    /stale object version/,
  );

  world = requestEditLock(world, {
    objectId,
    playerId: editorId,
    baseVersion: 1,
  }).world;

  assert.throws(
    () =>
      submitObjectEdit(world, {
        objectId,
        playerId: editorId,
        baseVersion: 0,
        builderSpec: createBuilderSpec({ requestId: "stale_edit" }),
      }),
    /stale object version/,
  );
});

test("submit edit enters cooldown and cooldown expiry returns object to public", () => {
  let world = createReleasedWorld({ objectCooldownSeconds: 7 });
  world = requestEditLock(world, {
    objectId,
    playerId: editorId,
    baseVersion: 1,
  }).world;

  const editedSpec = createBuilderSpec({
    requestId: "edit_1",
    category: "watchtower",
    operation: "refine",
    targetObjectId: objectId,
    baseObjectVersion: 1,
  });

  const submitted = submitObjectEdit(world, {
    objectId,
    playerId: editorId,
    baseVersion: 1,
    builderSpec: editedSpec,
  });

  const cooldownObject = requireObject(submitted.world);
  assert.equal(submitted.event.kind, "submit_object_edit");
  assert.equal(cooldownObject.state, "cooldown");
  assert.equal(cooldownObject.version, 2);
  assert.equal(cooldownObject.lock_owner_id, null);
  assert.equal(cooldownObject.cooldown_remaining_seconds, 7);
  assert.equal(cooldownObject.builder_spec.object_category, "watchtower");

  const expired = expireCooldown(submitted.world, { objectId });
  const publicObject = requireObject(expired.world);
  assert.equal(expired.event.kind, "expire_cooldown");
  assert.equal(publicObject.state, "public");
  assert.equal(publicObject.cooldown_remaining_seconds, 0);
});

test("destructive delete is blocked in public worlds and allowed in private destructive worlds", () => {
  const publicWorld = createReleasedWorld();

  assert.throws(
    () =>
      deleteObject(publicWorld, {
        objectId,
        playerId: editorId,
      }),
    /cannot delete released objects in this world/,
  );

  assert.throws(
    () =>
      deleteObject(publicWorld, {
        objectId,
        playerId: creatorId,
      }),
    /cannot delete released objects in this world/,
  );

  const privateWorld = createReleasedWorld({
    visibility: "private",
    destructiveEditsEnabled: true,
  });
  const privateDelete = deleteObject(privateWorld, {
    objectId,
    playerId: editorId,
  });
  assert.equal(privateDelete.event.kind, "delete_object");
  assert.equal(privateDelete.world.objects.length, 0);
});

test("malformed and out-of-bounds builder specs are rejected before reducer state changes", () => {
  const queued = requestCreateObject(createAuthorityWorld(), {
    jobId: "job_invalid",
    playerId: creatorId,
    sourcePrompt: "make an invalid object",
  });

  assert.throws(
    () =>
      submitAIDraft(queued.world, {
        jobId: "job_invalid",
        objectId,
        creatorId,
        builderSpec: createBuilderSpec({
          requestId: "empty_parts",
          parts: [],
          partCount: 0,
        }),
      }),
    /invalid builder spec: parts must not be empty/,
  );
  assert.equal(queued.world.jobs[0]?.status, "pending");
  assert.equal(queued.world.objects.length, 0);

  const world = createReleasedWorld();
  const locked = requestEditLock(world, {
    objectId,
    playerId: editorId,
    baseVersion: 1,
  });

  assert.throws(
    () =>
      submitObjectEdit(locked.world, {
        objectId,
        playerId: editorId,
        baseVersion: 1,
        builderSpec: createBuilderSpec({
          requestId: "huge_part",
          dimensions: [65, 1, 1],
        }),
      }),
    /invalid builder spec: part trunk dimensions must be within 0 and 64/,
  );

  const stillLocked = requireObject(locked.world);
  assert.equal(stillLocked.state, "edit_locked");
  assert.equal(stillLocked.version, 1);
});

function createReleasedWorld(config?: {
  destructiveEditsEnabled?: boolean;
  objectCooldownSeconds?: number;
  visibility?: "public" | "private";
}): AuthorityWorld {
  const draftWorld = createDraftWorld(config);
  return releaseObject(draftWorld, {
    objectId,
    playerId: creatorId,
  }).world;
}

function createDraftWorld(config?: {
  destructiveEditsEnabled?: boolean;
  objectCooldownSeconds?: number;
  visibility?: "public" | "private";
}): AuthorityWorld {
  let world = createAuthorityWorld({
    settings: {
      destructive_edits_enabled: config?.destructiveEditsEnabled ?? false,
      object_cooldown_seconds: config?.objectCooldownSeconds ?? 30,
      visibility: config?.visibility ?? "public",
    },
  });

  world = requestCreateObject(world, {
    jobId: "job_1",
    playerId: creatorId,
    sourcePrompt: "make a tree",
  }).world;

  world = submitAIDraft(world, {
    jobId: "job_1",
    objectId,
    creatorId,
    builderSpec: createBuilderSpec({ requestId: "draft_1" }),
    graceSeconds: 5,
  }).world;

  return world;
}

function requireObject(world: AuthorityWorld) {
  const object = world.objects.find((candidate) => candidate.object_id === objectId);
  assert.ok(object, "expected object to exist");
  return object;
}

function createBuilderSpec(input: {
  baseObjectVersion?: number | null;
  category?: string;
  dimensions?: [number, number, number];
  operation?: BuilderSpec["operation"];
  partCount?: number;
  parts?: BuilderSpec["parts"];
  requestId: string;
  targetObjectId?: string | null;
}): BuilderSpec {
  const parts =
    input.parts ??
    [
      {
        part_id: "trunk",
        primitive: "box",
        material: "wood",
        dimensions: input.dimensions ?? [1, 2, 1],
        modifiers: [],
      },
    ];

  return {
    builder_version: "0.1",
    request_id: input.requestId,
    intent_id: `${input.requestId}_intent`,
    operation: input.operation ?? "create",
    target_object_id: input.targetObjectId ?? null,
    base_object_version: input.baseObjectVersion ?? null,
    object_category: input.category ?? "tree",
    size_tier: "small",
    parts,
    instances: [
      {
        instance_id: "instance_0",
        anchor_mode: "absolute",
        reference_object: null,
        relation: null,
        offset: [0, 0, 0],
      },
    ],
    attachments: [],
    materials: ["wood"],
    behaviors: [],
    placement: {
      mode: "absolute",
      reference_object: null,
      relation: null,
      offset_meters: null,
    },
    complexity: {
      part_count: input.partCount ?? parts.length,
      instance_count: 1,
      behavior_count: 0,
    },
    diagnostics: [],
  };
}
