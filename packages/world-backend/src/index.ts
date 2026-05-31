import { SenderError, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";

import spacetimedb from "./schema";

const defaultWorldName = "Vibe Test Room";
const defaultWorldVisibility = "public";
const defaultMaxPlayers = 20;
const defaultObjectCooldownSeconds = 30;
const defaultGracePeriodSeconds = 12;
const maxNicknameLength = 24;
const maxIdLength = 80;
const maxPromptLength = 500;
const maxSourceSpecJsonLength = 300_000;
const maxBuilderSpecJsonLength = 200_000;
const maxHorizontalDistance = 256;
const minPlayerY = -8;
const maxPlayerY = 128;
const maxPitchRadians = Math.PI / 2;
const maxObjectPosition = 512;
const maxObjectRotation = Math.PI * 2;
const minObjectScale = 0.05;
const maxObjectScale = 64;

type BackendSchema = InferSchema<typeof spacetimedb>;
type BackendCtx = ReducerCtx<BackendSchema>;

export default spacetimedb;

export const init = spacetimedb.init((ctx) => {
  ensureDefaultWorld(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  markDisconnected(ctx);
});

export const join_world = spacetimedb.reducer(
  { nickname: t.string() },
  (ctx, { nickname }) => {
    const world = ensureDefaultWorld(ctx);
    const normalizedNickname = normalizeNickname(nickname);
    const existing = ctx.db.playerSession.identity.find(ctx.sender);

    if (!existing && activePlayersInWorld(ctx, world.worldId) >= world.maxPlayers) {
      throw new SenderError("world is full");
    }

    if (existing) {
      ctx.db.playerSession.identity.update({
        ...existing,
        connectionId: currentConnectionId(ctx),
        worldId: world.worldId,
        nickname: normalizedNickname,
        presenceState: "active",
        lastSeenAt: ctx.timestamp,
      });
      return;
    }

    ctx.db.playerSession.insert({
      identity: ctx.sender,
      worldId: world.worldId,
      connectionId: currentConnectionId(ctx),
      nickname: normalizedNickname,
      role: "player",
      presenceState: "active",
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationYaw: 0,
      rotationPitch: 0,
      joinedAt: ctx.timestamp,
      lastSeenAt: ctx.timestamp,
    });
  },
);

export const leave_world = spacetimedb.reducer((ctx) => {
  markDisconnected(ctx);
});

export const heartbeat_player = spacetimedb.reducer((ctx) => {
  const existing = ctx.db.playerSession.identity.find(ctx.sender);
  if (!existing) {
    throw new SenderError("player has not joined a world");
  }

  ctx.db.playerSession.identity.update({
    ...existing,
    connectionId: currentConnectionId(ctx),
    presenceState: "active",
    lastSeenAt: ctx.timestamp,
  });
});

export const move_player = spacetimedb.reducer(
  {
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
    rotationYaw: t.f64(),
    rotationPitch: t.f64(),
  },
  (ctx, { positionX, positionY, positionZ, rotationYaw, rotationPitch }) => {
    const existing = ctx.db.playerSession.identity.find(ctx.sender);
    if (!existing) {
      throw new SenderError("player has not joined a world");
    }
    if (existing.presenceState !== "active") {
      throw new SenderError("player is not active in a world");
    }

    assertPlayerTransform({
      positionX,
      positionY,
      positionZ,
      rotationYaw,
      rotationPitch,
    });

    ctx.db.playerSession.identity.update({
      ...existing,
      connectionId: currentConnectionId(ctx),
      positionX,
      positionY,
      positionZ,
      rotationYaw: normalizeAngle(rotationYaw),
      rotationPitch,
      lastSeenAt: ctx.timestamp,
    });
  },
);

export const request_create_object = spacetimedb.reducer(
  {
    jobId: t.string(),
    sourcePrompt: t.string(),
  },
  (ctx, { jobId, sourcePrompt }) => {
    const player = requireActivePlayer(ctx);
    const normalizedJobId = normalizeId("jobId", jobId);
    const normalizedPrompt = normalizePrompt(sourcePrompt);

    if (ctx.db.aiJob.jobId.find(normalizedJobId)) {
      throw new SenderError("AI job already exists");
    }

    ctx.db.aiJob.insert({
      jobId: normalizedJobId,
      worldId: player.worldId,
      playerIdentity: ctx.sender,
      targetObjectId: undefined,
      jobType: "create",
      status: "pending",
      sourcePrompt: normalizedPrompt,
      requestedAt: ctx.timestamp,
      completedAt: undefined,
      errorCode: undefined,
    });
  },
);

export const submit_ai_draft = spacetimedb.reducer(
  {
    jobId: t.string(),
    objectId: t.string(),
    sourceSpecJson: t.string(),
    builderSpecJson: t.string(),
  },
  (ctx, { jobId, objectId, sourceSpecJson, builderSpecJson }) => {
    const player = requireActivePlayer(ctx);
    const normalizedJobId = normalizeId("jobId", jobId);
    const normalizedObjectId = normalizeId("objectId", objectId);
    const job = requireAiJob(ctx, normalizedJobId);

    if (!sameIdentity(job.playerIdentity, ctx.sender)) {
      throw new SenderError("only the job owner can submit this draft");
    }
    if (job.worldId !== player.worldId) {
      throw new SenderError("AI job is not in the active player world");
    }
    if (job.status !== "pending") {
      throw new SenderError("AI job is not pending");
    }
    if (ctx.db.worldObject.objectId.find(normalizedObjectId)) {
      throw new SenderError("object already exists");
    }

    const sourceSpec = parseSourceSpecJson(sourceSpecJson);
    const builderSpec = parseBuilderSpecJson(builderSpecJson);
    assertArtifactMatchesSource(sourceSpec, builderSpec);
    const world = requireWorld(ctx, player.worldId);

    ctx.db.worldObject.insert({
      objectId: normalizedObjectId,
      worldId: player.worldId,
      state: "grace",
      version: 1,
      createdBy: job.playerIdentity,
      latestEditor: job.playerIdentity,
      graceOwner: job.playerIdentity,
      lockOwner: undefined,
      category: sourceSpec.category,
      sizeTier: sourceSpec.sizeTier,
      sourceSpecJson: sourceSpec.normalizedJson,
      builderSpecJson: builderSpec.normalizedJson,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      graceRemainingSeconds: world.gracePeriodSeconds,
      cooldownRemainingSeconds: 0,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    ctx.db.aiJob.jobId.update({
      ...job,
      targetObjectId: normalizedObjectId,
      status: "completed",
      completedAt: ctx.timestamp,
      errorCode: undefined,
    });
    replaceObjectLock(ctx, {
      objectId: normalizedObjectId,
      worldId: player.worldId,
      playerIdentity: job.playerIdentity,
      lockType: "grace",
      expiresInSeconds: world.gracePeriodSeconds,
    });
  },
);

export const update_draft_transform = spacetimedb.reducer(
  {
    objectId: t.string(),
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
    rotationX: t.f64(),
    rotationY: t.f64(),
    rotationZ: t.f64(),
    scaleX: t.f64(),
    scaleY: t.f64(),
    scaleZ: t.f64(),
  },
  (ctx, input) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", input.objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "grace");
    if (!sameIdentity(object.graceOwner, ctx.sender)) {
      throw new SenderError("only the grace owner can update draft transform");
    }
    assertObjectTransform(input);

    ctx.db.worldObject.objectId.update({
      ...object,
      positionX: input.positionX,
      positionY: input.positionY,
      positionZ: input.positionZ,
      rotationX: normalizeAngle(input.rotationX),
      rotationY: normalizeAngle(input.rotationY),
      rotationZ: normalizeAngle(input.rotationZ),
      scaleX: input.scaleX,
      scaleY: input.scaleY,
      scaleZ: input.scaleZ,
      updatedAt: ctx.timestamp,
    });
  },
);

export const release_object = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "grace");
    if (!sameIdentity(object.graceOwner, ctx.sender)) {
      throw new SenderError("only the grace owner can release this object");
    }

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "public",
      graceOwner: undefined,
      graceRemainingSeconds: 0,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const request_edit_lock = spacetimedb.reducer(
  {
    objectId: t.string(),
    baseVersion: t.u32(),
  },
  (ctx, { objectId, baseVersion }) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "public");
    if (object.version !== baseVersion) {
      throw new SenderError("stale object version for edit lock");
    }
    if (ctx.db.objectLock.objectId.find(object.objectId)) {
      throw new SenderError("object already has an active lock");
    }

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "edit_locked",
      lockOwner: ctx.sender,
      updatedAt: ctx.timestamp,
    });
    replaceObjectLock(ctx, {
      objectId: object.objectId,
      worldId: object.worldId,
      playerIdentity: ctx.sender,
      lockType: "edit",
      expiresInSeconds: 90,
    });
  },
);

export const update_locked_transform = spacetimedb.reducer(
  {
    objectId: t.string(),
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
    rotationX: t.f64(),
    rotationY: t.f64(),
    rotationZ: t.f64(),
    scaleX: t.f64(),
    scaleY: t.f64(),
    scaleZ: t.f64(),
  },
  (ctx, input) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", input.objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "edit_locked");
    if (!sameIdentity(object.lockOwner, ctx.sender)) {
      throw new SenderError("only the lock owner can update locked transform");
    }
    assertObjectTransform(input);

    ctx.db.worldObject.objectId.update({
      ...object,
      positionX: input.positionX,
      positionY: input.positionY,
      positionZ: input.positionZ,
      rotationX: normalizeAngle(input.rotationX),
      rotationY: normalizeAngle(input.rotationY),
      rotationZ: normalizeAngle(input.rotationZ),
      scaleX: input.scaleX,
      scaleY: input.scaleY,
      scaleZ: input.scaleZ,
      updatedAt: ctx.timestamp,
    });
  },
);

export const submit_object_edit = spacetimedb.reducer(
  {
    objectId: t.string(),
    baseVersion: t.u32(),
    sourceSpecJson: t.string(),
    builderSpecJson: t.string(),
  },
  (ctx, { objectId, baseVersion, sourceSpecJson, builderSpecJson }) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "edit_locked");
    if (!sameIdentity(object.lockOwner, ctx.sender)) {
      throw new SenderError("only the lock owner can submit an edit");
    }
    if (object.version !== baseVersion) {
      throw new SenderError("stale object version for edit submit");
    }

    const sourceSpec = parseSourceSpecJson(sourceSpecJson);
    const builderSpec = parseBuilderSpecJson(builderSpecJson);
    assertArtifactMatchesSource(sourceSpec, builderSpec);
    const world = requireWorld(ctx, object.worldId);

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "cooldown",
      version: object.version + 1,
      latestEditor: ctx.sender,
      lockOwner: undefined,
      category: sourceSpec.category,
      sizeTier: sourceSpec.sizeTier,
      sourceSpecJson: sourceSpec.normalizedJson,
      builderSpecJson: builderSpec.normalizedJson,
      cooldownRemainingSeconds: world.objectCooldownSeconds,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const cancel_edit = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "edit_locked");
    if (!sameIdentity(object.lockOwner, ctx.sender)) {
      throw new SenderError("only the lock owner can cancel this edit");
    }

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "public",
      lockOwner: undefined,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const delete_object = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const player = requireActivePlayer(ctx);
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertSameWorld(player.worldId, object.worldId);
    assertObjectState(object.state, "public");

    const world = requireWorld(ctx, object.worldId);
    if (world.visibility !== "private" || !world.destructiveEditsEnabled) {
      throw new SenderError("cannot delete released objects in this world");
    }

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "deleted",
      lockOwner: undefined,
      graceOwner: undefined,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const expire_grace_period = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertObjectState(object.state, "grace");

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "public",
      graceOwner: undefined,
      graceRemainingSeconds: 0,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const expire_edit_lock = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertObjectState(object.state, "edit_locked");

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "public",
      lockOwner: undefined,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  },
);

export const expire_cooldown = spacetimedb.reducer(
  { objectId: t.string() },
  (ctx, { objectId }) => {
    const object = requireWorldObject(ctx, normalizeId("objectId", objectId));
    assertObjectState(object.state, "cooldown");

    ctx.db.worldObject.objectId.update({
      ...object,
      state: "public",
      cooldownRemainingSeconds: 0,
      updatedAt: ctx.timestamp,
    });
  },
);

function ensureDefaultWorld(ctx: BackendCtx) {
  const existing = firstWorld(ctx);
  if (existing) {
    return existing;
  }

  return ctx.db.world.insert({
    worldId: 0n,
    name: defaultWorldName,
    visibility: defaultWorldVisibility,
    maxPlayers: defaultMaxPlayers,
    destructiveEditsEnabled: false,
    objectCooldownSeconds: defaultObjectCooldownSeconds,
    gracePeriodSeconds: defaultGracePeriodSeconds,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

function firstWorld(ctx: BackendCtx) {
  for (const world of ctx.db.world.iter()) {
    return world;
  }
  return null;
}

function activePlayersInWorld(ctx: BackendCtx, worldId: bigint) {
  let count = 0;
  for (const player of ctx.db.playerSession.iter()) {
    if (player.worldId === worldId && player.presenceState === "active") {
      count += 1;
    }
  }
  return count;
}

function requireActivePlayer(ctx: BackendCtx) {
  const existing = ctx.db.playerSession.identity.find(ctx.sender);
  if (!existing) {
    throw new SenderError("player has not joined a world");
  }
  if (existing.presenceState !== "active") {
    throw new SenderError("player is not active in a world");
  }
  return existing;
}

function requireWorld(ctx: BackendCtx, worldId: bigint) {
  const world = ctx.db.world.worldId.find(worldId);
  if (!world) {
    throw new SenderError("world not found");
  }
  return world;
}

function requireAiJob(ctx: BackendCtx, jobId: string) {
  const job = ctx.db.aiJob.jobId.find(jobId);
  if (!job) {
    throw new SenderError("AI job not found");
  }
  return job;
}

function requireWorldObject(ctx: BackendCtx, objectId: string) {
  const object = ctx.db.worldObject.objectId.find(objectId);
  if (!object) {
    throw new SenderError("object not found");
  }
  return object;
}

function assertSameWorld(playerWorldId: bigint, objectWorldId: bigint) {
  if (playerWorldId !== objectWorldId) {
    throw new SenderError("object is not in the active player world");
  }
}

function assertObjectState(actual: string, expected: string) {
  if (actual !== expected) {
    throw new SenderError(`invalid object state, expected ${expected} but got ${actual}`);
  }
}

function markDisconnected(ctx: BackendCtx) {
  const existing = ctx.db.playerSession.identity.find(ctx.sender);
  if (!existing) {
    return;
  }

  ctx.db.playerSession.identity.update({
    ...existing,
    connectionId: currentConnectionId(ctx),
    presenceState: "disconnected",
    lastSeenAt: ctx.timestamp,
  });
}

function currentConnectionId(ctx: BackendCtx) {
  return ctx.connectionId ?? undefined;
}

function replaceObjectLock(
  ctx: BackendCtx,
  input: {
    objectId: string;
    worldId: bigint;
    playerIdentity: BackendCtx["sender"];
    lockType: string;
    expiresInSeconds: number;
  },
) {
  clearObjectLock(ctx, input.objectId);
  ctx.db.objectLock.insert({
    objectId: input.objectId,
    worldId: input.worldId,
    playerIdentity: input.playerIdentity,
    lockType: input.lockType,
    grantedAt: ctx.timestamp,
    expiresAtMicros: expiresAtMicrosFromNow(ctx, input.expiresInSeconds),
  });
}

function clearObjectLock(ctx: BackendCtx, objectId: string) {
  ctx.db.objectLock.objectId.delete(objectId);
}

function expiresAtMicrosFromNow(ctx: BackendCtx, seconds: number) {
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(seconds) * 1_000_000n;
}

function assertPlayerTransform(transform: {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYaw: number;
  rotationPitch: number;
}) {
  assertFinite("positionX", transform.positionX);
  assertFinite("positionY", transform.positionY);
  assertFinite("positionZ", transform.positionZ);
  assertFinite("rotationYaw", transform.rotationYaw);
  assertFinite("rotationPitch", transform.rotationPitch);

  if (
    Math.abs(transform.positionX) > maxHorizontalDistance ||
    Math.abs(transform.positionZ) > maxHorizontalDistance ||
    transform.positionY < minPlayerY ||
    transform.positionY > maxPlayerY
  ) {
    throw new SenderError("player position is outside world bounds");
  }

  if (Math.abs(transform.rotationPitch) > maxPitchRadians) {
    throw new SenderError("player pitch is outside allowed bounds");
  }
}

function assertObjectTransform(transform: {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}) {
  assertFinite("positionX", transform.positionX);
  assertFinite("positionY", transform.positionY);
  assertFinite("positionZ", transform.positionZ);
  assertFinite("rotationX", transform.rotationX);
  assertFinite("rotationY", transform.rotationY);
  assertFinite("rotationZ", transform.rotationZ);
  assertFinite("scaleX", transform.scaleX);
  assertFinite("scaleY", transform.scaleY);
  assertFinite("scaleZ", transform.scaleZ);

  if (
    Math.abs(transform.positionX) > maxObjectPosition ||
    Math.abs(transform.positionY) > maxObjectPosition ||
    Math.abs(transform.positionZ) > maxObjectPosition
  ) {
    throw new SenderError("object position is outside world bounds");
  }

  if (
    Math.abs(transform.rotationX) > maxObjectRotation ||
    Math.abs(transform.rotationY) > maxObjectRotation ||
    Math.abs(transform.rotationZ) > maxObjectRotation
  ) {
    throw new SenderError("object rotation is outside allowed bounds");
  }

  if (
    transform.scaleX < minObjectScale ||
    transform.scaleY < minObjectScale ||
    transform.scaleZ < minObjectScale ||
    transform.scaleX > maxObjectScale ||
    transform.scaleY > maxObjectScale ||
    transform.scaleZ > maxObjectScale
  ) {
    throw new SenderError("object scale is outside allowed bounds");
  }
}

function assertFinite(label: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new SenderError(`${label} must be finite`);
  }
}

function normalizeAngle(value: number) {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

function normalizeId(label: string, value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new SenderError(`${label} is required`);
  }
  if (normalized.length > maxIdLength) {
    throw new SenderError(`${label} must be ${maxIdLength} characters or fewer`);
  }
  return normalized;
}

function normalizeNickname(nickname: string) {
  const normalized = nickname.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new SenderError("nickname is required");
  }
  if (normalized.length > maxNicknameLength) {
    throw new SenderError(`nickname must be ${maxNicknameLength} characters or fewer`);
  }
  return normalized;
}

function normalizePrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new SenderError("source prompt is required");
  }
  if (normalized.length > maxPromptLength) {
    throw new SenderError(`source prompt must be ${maxPromptLength} characters or fewer`);
  }
  return normalized;
}

function sameIdentity(
  left: { toHexString(): string } | undefined,
  right: { toHexString(): string },
) {
  return left?.toHexString() === right.toHexString();
}

function parseSourceSpecJson(sourceSpecJson: string) {
  const normalizedJson = sourceSpecJson.trim();
  if (!normalizedJson) {
    throw new SenderError("source spec JSON is required");
  }
  if (normalizedJson.length > maxSourceSpecJsonLength) {
    throw new SenderError(
      `source spec JSON must be ${maxSourceSpecJsonLength} characters or fewer`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedJson);
  } catch {
    throw new SenderError("source spec JSON is malformed");
  }

  if (!isRecord(parsed)) {
    throw new SenderError("source spec must be an object");
  }

  const operations = readSourceArrayField(parsed, "operations");
  if (!operations.length) {
    throw new SenderError("source spec operations must not be empty");
  }

  const placement = readSourceRecordField(parsed, "placement");
  assertBoundedNumberVector(
    "source spec placement offset",
    readSourceNumberArrayField(placement, "offset"),
    -512,
    512,
    true,
  );

  return {
    operation: readSourceStringField(parsed, "operation"),
    category: readSourceStringField(parsed, "object_category"),
    sizeTier: readSourceStringField(parsed, "size_tier"),
    normalizedJson,
  };
}

function parseBuilderSpecJson(builderSpecJson: string) {
  const normalizedJson = builderSpecJson.trim();
  if (!normalizedJson) {
    throw new SenderError("builder spec JSON is required");
  }
  if (normalizedJson.length > maxBuilderSpecJsonLength) {
    throw new SenderError(
      `builder spec JSON must be ${maxBuilderSpecJsonLength} characters or fewer`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedJson);
  } catch {
    throw new SenderError("builder spec JSON is malformed");
  }

  if (!isRecord(parsed)) {
    throw new SenderError("builder spec must be an object");
  }

  const parts = readArrayField(parsed, "parts");
  const instances = readArrayField(parsed, "instances");
  if (!parts.length) {
    throw new SenderError("builder spec parts must not be empty");
  }

  const complexity = readRecordField(parsed, "complexity");
  const partCount = readIntegerField(complexity, "part_count");
  const instanceCount = readIntegerField(complexity, "instance_count");
  if (partCount !== parts.length) {
    throw new SenderError("builder spec part count does not match parts");
  }
  if (instanceCount !== instances.length) {
    throw new SenderError("builder spec instance count does not match instances");
  }

  parts.forEach((part, index) => {
    if (!isRecord(part)) {
      throw new SenderError(`builder spec part ${index} must be an object`);
    }
    assertBoundedNumberVector(
      `builder spec part ${index} dimensions`,
      readNumberArrayField(part, "dimensions"),
      0,
      64,
      false,
    );
  });

  instances.forEach((instance, index) => {
    if (!isRecord(instance)) {
      throw new SenderError(`builder spec instance ${index} must be an object`);
    }
    assertBoundedNumberVector(
      `builder spec instance ${index} offset`,
      readNumberArrayField(instance, "offset"),
      -512,
      512,
      true,
    );
  });

  return {
    operation: readStringField(parsed, "operation"),
    category: readStringField(parsed, "object_category"),
    sizeTier: readStringField(parsed, "size_tier"),
    normalizedJson,
  };
}

function assertArtifactMatchesSource(
  sourceSpec: {
    operation: string;
    category: string;
    sizeTier: string;
  },
  builderSpec: {
    operation: string;
    category: string;
    sizeTier: string;
  },
) {
  if (sourceSpec.operation !== builderSpec.operation) {
    throw new SenderError("builder artifact operation does not match source spec");
  }
  if (sourceSpec.category !== builderSpec.category) {
    throw new SenderError("builder artifact category does not match source spec");
  }
  if (sourceSpec.sizeTier !== builderSpec.sizeTier) {
    throw new SenderError("builder artifact size tier does not match source spec");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecordField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!isRecord(fieldValue)) {
    throw new SenderError(`builder spec ${field} must be an object`);
  }
  return fieldValue;
}

function readSourceRecordField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!isRecord(fieldValue)) {
    throw new SenderError(`source spec ${field} must be an object`);
  }
  return fieldValue;
}

function readArrayField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    throw new SenderError(`builder spec ${field} must be an array`);
  }
  return fieldValue;
}

function readSourceArrayField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    throw new SenderError(`source spec ${field} must be an array`);
  }
  return fieldValue;
}

function readStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || !fieldValue.trim()) {
    throw new SenderError(`builder spec ${field} must be a non-empty string`);
  }
  return fieldValue;
}

function readSourceStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || !fieldValue.trim()) {
    throw new SenderError(`source spec ${field} must be a non-empty string`);
  }
  return fieldValue;
}

function readIntegerField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!Number.isInteger(fieldValue)) {
    throw new SenderError(`builder spec ${field} must be an integer`);
  }
  return fieldValue;
}

function readNumberArrayField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || fieldValue.length !== 3) {
    throw new SenderError(`builder spec ${field} must be a vector3`);
  }
  return fieldValue;
}

function readSourceNumberArrayField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || fieldValue.length !== 3) {
    throw new SenderError(`source spec ${field} must be a vector3`);
  }
  return fieldValue;
}

function assertBoundedNumberVector(
  label: string,
  values: unknown[],
  min: number,
  max: number,
  allowMin: boolean,
) {
  const isValid = values.every((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    return allowMin ? value >= min && value <= max : value > min && value <= max;
  });

  if (!isValid) {
    throw new SenderError(`${label} must be within ${min} and ${max}`);
  }
}
