import type {
  AuthorityActionResult,
  AuthorityEvent,
  AuthorityObject,
  AuthorityWorld,
  AuthorityWorldSettings,
  BuilderSpec,
  DraftTransformPatch,
} from "./contracts";

export function createAuthorityWorld(config?: {
  worldId?: string;
  settings?: Partial<AuthorityWorldSettings>;
}): AuthorityWorld {
  return {
    world_id: config?.worldId ?? "world_fixture_1",
    settings: {
      visibility: "public",
      destructive_edits_enabled: false,
      object_cooldown_seconds: 30,
      protected_spawn_enabled: true,
      ...config?.settings,
    },
    jobs: [],
    objects: [],
    events: [],
  };
}

export function requestCreateObject(
  world: AuthorityWorld,
  input: {
    jobId: string;
    playerId: string;
    sourcePrompt: string;
  },
): AuthorityActionResult {
  if (world.jobs.some((job) => job.job_id === input.jobId)) {
    throw new Error(`job already exists: ${input.jobId}`);
  }

  const nextWorld = cloneWorld(world);
  nextWorld.jobs.push({
    job_id: input.jobId,
    world_id: world.world_id,
    player_id: input.playerId,
    source_prompt: input.sourcePrompt,
    status: "pending",
  });

  return commitEvent(nextWorld, {
    kind: "request_create_object",
    player_id: input.playerId,
    message: `queued create request for ${input.sourcePrompt}`,
  });
}

export function submitAIDraft(
  world: AuthorityWorld,
  input: {
    jobId: string;
    objectId: string;
    creatorId: string;
    builderSpec: BuilderSpec;
    graceSeconds?: number;
  },
): AuthorityActionResult {
  const job = world.jobs.find((candidate) => candidate.job_id === input.jobId);
  if (!job) {
    throw new Error(`job not found: ${input.jobId}`);
  }
  if (job.status !== "pending") {
    throw new Error(`job is not pending: ${input.jobId}`);
  }

  const nextWorld = cloneWorld(world);
  const nextJob = nextWorld.jobs.find((candidate) => candidate.job_id === input.jobId);
  if (!nextJob) {
    throw new Error(`job not found after clone: ${input.jobId}`);
  }
  nextJob.status = "completed";

  nextWorld.objects.push({
    object_id: input.objectId,
    world_id: nextWorld.world_id,
    state: "grace",
    version: 1,
    created_by: input.creatorId,
    latest_editor: input.creatorId,
    grace_owner_id: input.creatorId,
    lock_owner_id: null,
    builder_spec: input.builderSpec,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    cooldown_remaining_seconds: 0,
    grace_remaining_seconds: input.graceSeconds ?? 12,
  });

  return commitEvent(nextWorld, {
    kind: "submit_ai_draft",
    object_id: input.objectId,
    player_id: input.creatorId,
    message: `authoritative draft accepted for ${input.builderSpec.object_category}`,
  });
}

export function updateDraftTransform(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
    patch: DraftTransformPatch;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "grace");
  if (object.grace_owner_id !== input.playerId) {
    throw new Error("only the grace owner can update draft transform");
  }

  object.transform = applyTransformPatch(object.transform, input.patch);

  return commitEvent(nextWorld, {
    kind: "update_draft_transform",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "updated draft transform during grace period",
  });
}

export function releaseObject(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "grace");
  if (object.grace_owner_id !== input.playerId) {
    throw new Error("only the grace owner can release this object");
  }

  object.state = "public";
  object.grace_owner_id = null;
  object.grace_remaining_seconds = 0;

  return commitEvent(nextWorld, {
    kind: "release_object",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "released object into the public world",
  });
}

/**
 * Discard a draft object during the grace window. Only the grace owner can
 * call this. Used when the player rejects their own draft mid-conversation
 * (e.g. "no, I want a bus instead") before it has been released to the world.
 * The object transitions to "deleted" and is removed from the active world.
 */
export function discardDraft(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "grace");
  if (object.grace_owner_id !== input.playerId) {
    throw new Error("only the grace owner can discard this draft");
  }

  object.state = "deleted";
  object.grace_owner_id = null;
  object.grace_remaining_seconds = 0;
  nextWorld.objects = nextWorld.objects.filter((o) => o.object_id !== input.objectId);

  return commitEvent(nextWorld, {
    kind: "discard_draft",
    object_id: input.objectId,
    player_id: input.playerId,
    message: `discarded draft ${input.objectId} during grace period`,
  });
}

export function updateLockedTransform(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
    patch: DraftTransformPatch;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "edit_locked");
  if (object.lock_owner_id !== input.playerId) {
    throw new Error("only the lock owner can update locked transform");
  }

  object.transform = applyTransformPatch(object.transform, input.patch);

  return commitEvent(nextWorld, {
    kind: "update_locked_transform",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "updated locked object transform during edit session",
  });
}

export function requestEditLock(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
    baseVersion: number;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "public");
  if (object.version !== input.baseVersion) {
    throw new Error("stale object version for edit lock");
  }

  object.state = "edit_locked";
  object.lock_owner_id = input.playerId;

  return commitEvent(nextWorld, {
    kind: "request_edit_lock",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "granted exclusive edit lock",
  });
}

export function releaseEditLock(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "edit_locked");
  if (object.lock_owner_id !== input.playerId) {
    throw new Error("only the lock owner can release this edit");
  }

  object.state = "public";
  object.lock_owner_id = null;
  object.latest_editor = input.playerId;
  object.version += 1;

  return commitEvent(nextWorld, {
    kind: "release_edit_lock",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "released edit lock and published transform changes",
  });
}

export function submitObjectEdit(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
    baseVersion: number;
    builderSpec: BuilderSpec;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "edit_locked");
  if (object.lock_owner_id !== input.playerId) {
    throw new Error("only the lock owner can submit an edit");
  }
  if (object.version !== input.baseVersion) {
    throw new Error("stale object version for edit submit");
  }

  object.builder_spec = input.builderSpec;
  object.latest_editor = input.playerId;
  object.version += 1;
  object.state = "cooldown";
  object.lock_owner_id = null;
  object.cooldown_remaining_seconds = nextWorld.settings.object_cooldown_seconds;

  return commitEvent(nextWorld, {
    kind: "submit_object_edit",
    object_id: input.objectId,
    player_id: input.playerId,
    message: `accepted edit and entered ${object.cooldown_remaining_seconds}s cooldown`,
  });
}

export function cancelEdit(
  world: AuthorityWorld,
  input: {
    objectId: string;
    playerId: string;
  },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "edit_locked");
  if (object.lock_owner_id !== input.playerId) {
    throw new Error("only the lock owner can cancel this edit");
  }

  object.state = "public";
  object.lock_owner_id = null;

  return commitEvent(nextWorld, {
    kind: "cancel_edit",
    object_id: input.objectId,
    player_id: input.playerId,
    message: "cancelled edit and returned object to public",
  });
}

export function expireGracePeriod(
  world: AuthorityWorld,
  input: { objectId: string },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "grace");

  object.state = "public";
  object.grace_owner_id = null;
  object.grace_remaining_seconds = 0;

  return commitEvent(nextWorld, {
    kind: "expire_grace_period",
    object_id: input.objectId,
    message: "grace period expired",
  });
}

export function expireEditLock(
  world: AuthorityWorld,
  input: { objectId: string },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "edit_locked");

  object.state = "public";
  object.lock_owner_id = null;

  return commitEvent(nextWorld, {
    kind: "expire_edit_lock",
    object_id: input.objectId,
    message: "inactive edit lock expired",
  });
}

export function expireCooldown(
  world: AuthorityWorld,
  input: { objectId: string },
): AuthorityActionResult {
  const nextWorld = cloneWorld(world);
  const object = getMutableObject(nextWorld, input.objectId);
  assertState(object, "cooldown");

  object.state = "public";
  object.cooldown_remaining_seconds = 0;

  return commitEvent(nextWorld, {
    kind: "expire_cooldown",
    object_id: input.objectId,
    message: "cooldown expired and object returned to public",
  });
}

export function getPrimaryObject(world: AuthorityWorld) {
  return world.objects[0] ?? null;
}

function applyTransformPatch(
  transform: AuthorityObject["transform"],
  patch: DraftTransformPatch,
): AuthorityObject["transform"] {
  return {
    position: [
      patch.position?.x ?? transform.position[0],
      patch.position?.y ?? transform.position[1],
      patch.position?.z ?? transform.position[2],
    ],
    rotation: [
      patch.rotation?.x ?? transform.rotation[0],
      patch.rotation?.y ?? transform.rotation[1],
      patch.rotation?.z ?? transform.rotation[2],
    ],
    scale: [
      patch.scale?.x ?? transform.scale[0],
      patch.scale?.y ?? transform.scale[1],
      patch.scale?.z ?? transform.scale[2],
    ],
  };
}

function getMutableObject(world: AuthorityWorld, objectId: string) {
  const object = world.objects.find((candidate) => candidate.object_id === objectId);
  if (!object) {
    throw new Error(`object not found: ${objectId}`);
  }
  return object;
}

function assertState(object: AuthorityObject, expectedState: AuthorityObject["state"]) {
  if (object.state !== expectedState) {
    throw new Error(
      `invalid object state, expected ${expectedState} but got ${object.state}`,
    );
  }
}

function cloneWorld(world: AuthorityWorld): AuthorityWorld {
  return structuredClone(world);
}

function commitEvent(
  world: AuthorityWorld,
  input: Omit<AuthorityEvent, "id">,
): AuthorityActionResult {
  const event = {
    id: `${input.kind}_${world.events.length}`,
    ...input,
  } satisfies AuthorityEvent;
  world.events.unshift(event);
  world.events = world.events.slice(0, 10);
  return { world, event };
}
