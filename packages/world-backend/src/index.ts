import {
  SenderError,
  t,
  type InferSchema,
  type ReducerCtx,
} from "spacetimedb/server";
import { checkProfanity } from "glin-profanity";

import spacetimedb from "./schema";
import {
  bootstrapModeratorIdentities,
  ownerAdminIdentities,
} from "./moderation-config";

const defaultWorldName = "Vibe Test Room";
// The shared test room is private + destructive so players can delete objects.
const defaultWorldVisibility = "private";
const defaultMaxPlayers = 20;
const defaultObjectCooldownSeconds = 30;
const defaultGracePeriodSeconds = 12;
const defaultMaxLiveObjectsPerPublicWorld = 120;
const defaultMaxLiveObjectsPerPublicPlayer = 12;
const defaultMaxPendingCreateJobsPerPublicPlayer = 1;
const maxAllowedPlayers = 32;
const maxAllowedLiveObjects = 500;
const maxAllowedObjectsPerPlayer = 100;
const maxAllowedPendingCreateJobsPerPlayer = 5;
const maxAllowedObjectCooldownSeconds = 300;
const maxAllowedGracePeriodSeconds = 120;
// Only the creator may delete a freshly created object within this window.
const deletionProtectionMicros = 90n * 1_000_000n;
const maxWorldNameLength = 48;
const maxNicknameLength = 24;
const maxIdLength = 80;
const maxSnapshotObjectIdLength = 180;
const maxPromptLength = 500;
const maxChatBodyLength = 280;
// Cap persisted chat per world; oldest messages beyond this are pruned on send.
const maxChatHistoryPerWorld = 200;
// Moderator/owner trust-roots live in ./moderation-config (resolved at build time from
// env vars; empty by default so no personal identity is committed).
// Roles that set_player_role may assign. "host"/"platform_admin" are reserved.
const assignableRoles = new Set(["player", "moderator"]);
const maxSourceSpecJsonLength = 300_000;
const maxBuilderSpecJsonLength = 200_000;
// Feedback snapshots are small (the prompt + both spec JSONs); cap them so a single
// row can't be used to bloat the submit-only table.
const maxFeedbackPromptLength = 1_000;
const maxFeedbackJsonLength = 16_000;
const feedbackOperations = new Set(["create", "edit"]);
const feedbackRatings = new Set(["up", "down"]);
const maxHorizontalDistance = 256;
const minPlayerY = -8;
const maxPlayerY = 128;
const maxPitchRadians = Math.PI / 2;
// Avatar bodies are standing characters; cap the JSON like other specs and
// reject anything whose compiled builder parts exceed the avatar clamp. The
// clamp guards against extreme geometry only — rendered size comes from the
// explicit `scale` field (the client normalizes geometry to human height and
// multiplies by scale), so a roomy clamp is safe.
const maxAvatarVoxelCoreJsonLength = 200_000;
const maxAvatarBuilderSpecJsonLength = 200_000;
const avatarClampWidth = 8;
const avatarClampHeight = 12;
const avatarClampDepth = 8;
// Rendered size multiplier: 1 = human height; "make me 4 times larger" → 4.
const avatarMinScale = 0.25;
const avatarMaxScale = 4;
// Avatar editing must not become a spam channel: reject updates < 10 s apart.
const avatarUpdateCooldownMicros = 10n * 1_000_000n;
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
    joinWorld(ctx, ensureDefaultWorld(ctx), nickname, "player");
  },
);

export const join_world_by_id = spacetimedb.reducer(
  { worldId: t.u64(), nickname: t.string() },
  (ctx, { worldId, nickname }) => {
    joinWorld(ctx, requireWorld(ctx, worldId), nickname, "player");
  },
);

export const create_world = spacetimedb.reducer(
  { name: t.string(), visibility: t.string(), nickname: t.string() },
  (ctx, { name, visibility, nickname }) => {
    const normalizedVisibility = normalizeWorldVisibility(visibility);
    const world = ctx.db.world.insert({
      worldId: nextWorldId(ctx),
      name: normalizeWorldName(name),
      visibility: normalizedVisibility,
      maxPlayers: defaultMaxPlayers,
      maxLiveObjects: defaultMaxLiveObjectsPerPublicWorld,
      maxObjectsPerPlayer: defaultMaxLiveObjectsPerPublicPlayer,
      maxPendingCreateJobsPerPlayer: defaultMaxPendingCreateJobsPerPublicPlayer,
      destructiveEditsEnabled: false,
      objectCooldownSeconds: defaultObjectCooldownSeconds,
      gracePeriodSeconds: defaultGracePeriodSeconds,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    joinWorld(ctx, world, nickname, "host");
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

export const set_avatar_spec = spacetimedb.reducer(
  {
    voxelCoreJson: t.string(),
    builderSpecJson: t.string(),
    scale: t.f64(),
  },
  (ctx, { voxelCoreJson, builderSpecJson, scale }) => {
    const player = requireActivePlayer(ctx);

    const voxelCore = parseAvatarVoxelCoreJson(voxelCoreJson);
    const builderSpec = parseAvatarBuilderSpecJson(builderSpecJson);
    if (
      !Number.isFinite(scale) ||
      scale < avatarMinScale ||
      scale > avatarMaxScale
    ) {
      throw new SenderError(
        `avatar scale must be between ${avatarMinScale} and ${avatarMaxScale}`,
      );
    }

    const existing = ctx.db.playerAvatar.identity.find(ctx.sender);
    if (existing) {
      const elapsedMicros =
        ctx.timestamp.microsSinceUnixEpoch -
        existing.updatedAt.microsSinceUnixEpoch;
      if (elapsedMicros < avatarUpdateCooldownMicros) {
        throw new SenderError("avatar was updated too recently");
      }
    }

    if (existing) {
      ctx.db.playerAvatar.identity.update({
        ...existing,
        voxelCoreJson: voxelCore.normalizedJson,
        builderSpecJson: builderSpec.normalizedJson,
        scale,
        version: existing.version + 1,
        updatedAt: ctx.timestamp,
      });
    } else {
      ctx.db.playerAvatar.insert({
        identity: ctx.sender,
        voxelCoreJson: voxelCore.normalizedJson,
        builderSpecJson: builderSpec.normalizedJson,
        scale,
        version: 1,
        updatedAt: ctx.timestamp,
      });
    }

    // Touch the session so presence stays warm after an avatar swap.
    ctx.db.playerSession.identity.update({
      ...player,
      lastSeenAt: ctx.timestamp,
    });
  },
);

export const send_chat_message = spacetimedb.reducer(
  { body: t.string() },
  (ctx, { body }) => {
    const player = requireActivePlayer(ctx);

    const trimmed = body.trim();
    if (!trimmed) {
      throw new SenderError("chat message is empty");
    }
    if (trimmed.length > maxChatBodyLength) {
      throw new SenderError("chat message is too long");
    }
    if (
      checkProfanity(trimmed, { languages: ["english"], detectLeetspeak: true })
        .containsProfanity
    ) {
      throw new SenderError("chat message contains blocked language");
    }

    ctx.db.chatMessage.insert({
      messageId: 0n, // autoInc assigns the real id
      worldId: player.worldId,
      senderIdentity: ctx.sender,
      senderNickname: player.nickname,
      body: trimmed,
      createdAt: ctx.timestamp,
    });

    pruneChatHistory(ctx, player.worldId);
  },
);

export const delete_chat_message = spacetimedb.reducer(
  { messageId: t.u64() },
  (ctx, { messageId }) => {
    const player = requireActivePlayer(ctx);
    const message = ctx.db.chatMessage.messageId.find(messageId);
    if (!message) {
      throw new SenderError("chat message not found");
    }
    if (message.worldId !== player.worldId) {
      throw new SenderError("chat message is not in the active player world");
    }

    const isAuthor = sameIdentity(message.senderIdentity, ctx.sender);
    if (!isAuthor && !canManageWorldLifecycle(player)) {
      throw new SenderError(
        "only the author or a moderator can delete this message",
      );
    }

    ctx.db.chatMessage.messageId.delete(messageId);
  },
);

export const set_player_role = spacetimedb.reducer(
  { targetIdentityHex: t.string(), role: t.string() },
  (ctx, { targetIdentityHex, role }) => {
    // Owner/admin only — identity-gated, not role-gated, so moderators cannot mint more
    // moderators. The caller does not need to have joined the world.
    if (!isOwnerAdmin(ctx)) {
      throw new SenderError("only an owner/admin can set player roles");
    }
    if (!assignableRoles.has(role)) {
      throw new SenderError("unsupported role");
    }

    const wanted = normalizeHex(targetIdentityHex);
    const target = Array.from(ctx.db.playerSession.iter()).find(
      (player) => normalizeHex(player.identity.toHexString()) === wanted,
    );
    if (!target) {
      throw new SenderError("target player not found");
    }

    ctx.db.playerSession.identity.update({
      ...target,
      role,
      lastSeenAt: ctx.timestamp,
    });
  },
);

export const update_world_settings = spacetimedb.reducer(
  {
    visibility: t.string(),
    maxPlayers: t.u32(),
    maxLiveObjects: t.u32(),
    maxObjectsPerPlayer: t.u32(),
    maxPendingCreateJobsPerPlayer: t.u32(),
    destructiveEditsEnabled: t.bool(),
    objectCooldownSeconds: t.u32(),
    gracePeriodSeconds: t.u32(),
  },
  (ctx, input) => {
    const player = requireActivePlayer(ctx);
    assertCanManageWorldLifecycle(player);
    const world = requireWorld(ctx, player.worldId);
    const visibility = normalizeWorldVisibility(input.visibility);

    if (visibility === "public" && input.destructiveEditsEnabled) {
      throw new SenderError("public worlds cannot enable destructive edits");
    }
    assertU32Range("maxPlayers", input.maxPlayers, 1, maxAllowedPlayers);
    assertU32Range(
      "maxLiveObjects",
      input.maxLiveObjects,
      1,
      maxAllowedLiveObjects,
    );
    assertU32Range(
      "maxObjectsPerPlayer",
      input.maxObjectsPerPlayer,
      1,
      maxAllowedObjectsPerPlayer,
    );
    assertU32Range(
      "maxPendingCreateJobsPerPlayer",
      input.maxPendingCreateJobsPerPlayer,
      1,
      maxAllowedPendingCreateJobsPerPlayer,
    );
    assertU32Range(
      "objectCooldownSeconds",
      input.objectCooldownSeconds,
      0,
      maxAllowedObjectCooldownSeconds,
    );
    assertU32Range(
      "gracePeriodSeconds",
      input.gracePeriodSeconds,
      0,
      maxAllowedGracePeriodSeconds,
    );
    if (input.maxObjectsPerPlayer > input.maxLiveObjects) {
      throw new SenderError("maxObjectsPerPlayer cannot exceed maxLiveObjects");
    }
    if (input.maxPlayers < activePlayersInWorld(ctx, world.worldId)) {
      throw new SenderError(
        "maxPlayers cannot be lower than current active players",
      );
    }

    ctx.db.world.worldId.update({
      ...world,
      visibility,
      maxPlayers: input.maxPlayers,
      maxLiveObjects: input.maxLiveObjects,
      maxObjectsPerPlayer: input.maxObjectsPerPlayer,
      maxPendingCreateJobsPerPlayer: input.maxPendingCreateJobsPerPlayer,
      destructiveEditsEnabled: input.destructiveEditsEnabled,
      objectCooldownSeconds: input.objectCooldownSeconds,
      gracePeriodSeconds: input.gracePeriodSeconds,
      updatedAt: ctx.timestamp,
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
    const world = requireWorld(ctx, player.worldId);

    if (ctx.db.aiJob.jobId.find(normalizedJobId)) {
      throw new SenderError("AI job already exists");
    }
    assertPublicCreationGuardrails(ctx, world, ctx.sender, {
      includePendingJobs: true,
    });

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
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
  },
  (ctx, { jobId, objectId, sourceSpecJson, builderSpecJson, positionX, positionY, positionZ }) => {
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
    const world = requireWorld(ctx, player.worldId);
    assertPublicCreationGuardrails(ctx, world, job.playerIdentity, {
      includePendingJobs: false,
    });

    const sourceSpec = parseSourceSpecJson(sourceSpecJson);
    const builderSpec = parseBuilderSpecJson(builderSpecJson);
    assertArtifactMatchesSource(sourceSpec, builderSpec);

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
      positionX,
      positionY,
      positionZ,
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

export const fail_ai_job = spacetimedb.reducer(
  {
    jobId: t.string(),
    errorCode: t.string(),
  },
  (ctx, { jobId, errorCode }) => {
    const player = requireActivePlayer(ctx);
    const normalizedJobId = normalizeId("jobId", jobId);
    const job = requireAiJob(ctx, normalizedJobId);
    assertCanFailAiJob(player, job, ctx.sender);
    assertPendingAiJob(job);

    ctx.db.aiJob.jobId.update({
      ...job,
      status: "failed",
      completedAt: ctx.timestamp,
      errorCode: normalizeAiJobErrorCode(errorCode),
    });
  },
);

export const expire_ai_job = spacetimedb.reducer(
  {
    jobId: t.string(),
  },
  (ctx, { jobId }) => {
    const player = requireActivePlayer(ctx);
    const normalizedJobId = normalizeId("jobId", jobId);
    const job = requireAiJob(ctx, normalizedJobId);
    assertCanFailAiJob(player, job, ctx.sender);
    assertPendingAiJob(job);

    ctx.db.aiJob.jobId.update({
      ...job,
      status: "failed",
      completedAt: ctx.timestamp,
      errorCode: "timeout",
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
    const object = requireWorldObject(
      ctx,
      normalizeId("objectId", input.objectId),
    );
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
    const object = requireWorldObject(
      ctx,
      normalizeId("objectId", input.objectId),
    );
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

    // Within the protection window, only the creator may delete a freshly created
    // object so other players can't immediately wipe someone's new creation.
    const ageMicros =
      ctx.timestamp.microsSinceUnixEpoch -
      object.createdAt.microsSinceUnixEpoch;
    if (
      !sameIdentity(object.createdBy, ctx.sender) &&
      ageMicros < deletionProtectionMicros
    ) {
      throw new SenderError(
        "object is protected from deletion for 90 seconds after creation",
      );
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

export const submit_object_feedback = spacetimedb.reducer(
  {
    operationId: t.string(),
    objectId: t.string(),
    objectVersion: t.u32(),
    operation: t.string(),
    rating: t.string(),
    sourcePrompt: t.string(),
    sourceSpecJson: t.string(),
    builderSpecJson: t.string(),
    modelId: t.string(),
    promptVersion: t.string(),
  },
  (ctx, input) => {
    const player = requireActivePlayer(ctx);

    const operationId = normalizeId("operationId", input.operationId);
    const objectId = normalizeId("objectId", input.objectId);
    if (!feedbackOperations.has(input.operation)) {
      throw new SenderError("feedback operation must be create or edit");
    }
    if (!feedbackRatings.has(input.rating)) {
      throw new SenderError("feedback rating must be up or down");
    }
    const sourcePrompt = normalizeFeedbackText(
      "source prompt",
      input.sourcePrompt,
      maxFeedbackPromptLength,
    );
    const sourceSpecJson = normalizeFeedbackText(
      "source spec JSON",
      input.sourceSpecJson,
      maxFeedbackJsonLength,
    );
    const builderSpecJson = normalizeFeedbackText(
      "builder spec JSON",
      input.builderSpecJson,
      maxFeedbackJsonLength,
    );
    const modelId = normalizeFeedbackText("model id", input.modelId, maxIdLength);
    const promptVersion = normalizeFeedbackText(
      "prompt version",
      input.promptVersion,
      maxIdLength,
    );

    // Submit-once: one rating per operation. No composite unique index in the SQL
    // subset, so scan for an existing row with this operationId and reject if found
    // (no upsert — the client also hides the card locally, so this is the safety net).
    for (const existing of ctx.db.objectFeedback.iter()) {
      if (existing.operationId === operationId) {
        throw new SenderError("feedback already submitted for this operation");
      }
    }

    ctx.db.objectFeedback.insert({
      feedbackId: 0n, // autoInc assigns the real id
      worldId: player.worldId,
      objectId,
      objectVersion: input.objectVersion,
      operationId,
      operation: input.operation,
      rating: input.rating,
      sourcePrompt,
      sourceSpecJson,
      builderSpecJson,
      modelId,
      promptVersion,
      playerIdentity: ctx.sender,
      playerNickname: player.nickname,
      createdAt: ctx.timestamp,
    });
  },
);

export const create_snapshot = spacetimedb.reducer(
  {
    snapshotId: t.string(),
    reason: t.string(),
  },
  (ctx, { snapshotId, reason }) => {
    const player = requireActivePlayer(ctx);
    assertCanManageWorldLifecycle(player);
    const world = requireWorld(ctx, player.worldId);

    createWorldSnapshot(ctx, {
      world,
      snapshotId,
      reason,
    });
  },
);

export const reset_world = spacetimedb.reducer(
  {
    snapshotId: t.string(),
    reason: t.string(),
  },
  (ctx, { snapshotId, reason }) => {
    const player = requireActivePlayer(ctx);
    assertCanManageWorldLifecycle(player);
    const world = requireWorld(ctx, player.worldId);

    createWorldSnapshot(ctx, {
      world,
      snapshotId,
      reason,
    });
    deleteLiveWorldObjects(ctx, world.worldId);
    failPendingWorldJobs(ctx, world.worldId);
  },
);

function ensureDefaultWorld(ctx: BackendCtx) {
  const existing = findDefaultWorld(ctx);
  if (existing) {
    return existing;
  }

  return ctx.db.world.insert({
    worldId: 0n,
    name: defaultWorldName,
    visibility: defaultWorldVisibility,
    maxPlayers: defaultMaxPlayers,
    maxLiveObjects: defaultMaxLiveObjectsPerPublicWorld,
    maxObjectsPerPlayer: defaultMaxLiveObjectsPerPublicPlayer,
    maxPendingCreateJobsPerPlayer: defaultMaxPendingCreateJobsPerPublicPlayer,
    destructiveEditsEnabled: true,
    objectCooldownSeconds: defaultObjectCooldownSeconds,
    gracePeriodSeconds: defaultGracePeriodSeconds,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

function findDefaultWorld(ctx: BackendCtx) {
  for (const world of ctx.db.world.iter()) {
    if (
      world.name === defaultWorldName &&
      world.visibility === defaultWorldVisibility
    ) {
      return world;
    }
  }
  return null;
}

function nextWorldId(ctx: BackendCtx) {
  let maxWorldId = -1n;
  for (const world of ctx.db.world.iter()) {
    if (world.worldId > maxWorldId) {
      maxWorldId = world.worldId;
    }
  }
  return maxWorldId + 1n;
}

function joinWorld(
  ctx: BackendCtx,
  world: ReturnType<typeof requireWorld>,
  nickname: string,
  role: string,
) {
  const normalizedNickname = normalizeNickname(nickname);
  const existing = ctx.db.playerSession.identity.find(ctx.sender);
  const movingWorlds = existing ? existing.worldId !== world.worldId : true;

  if (
    movingWorlds &&
    activePlayersInWorld(ctx, world.worldId) >= world.maxPlayers
  ) {
    throw new SenderError("world is full");
  }

  const bootstrapRole = bootstrapModeratorRole(ctx);

  if (existing) {
    ctx.db.playerSession.identity.update({
      ...existing,
      connectionId: currentConnectionId(ctx),
      worldId: world.worldId,
      nickname: normalizedNickname,
      role:
        bootstrapRole ??
        (existing.worldId === world.worldId ? existing.role : role),
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
    role: bootstrapRole ?? role,
    presenceState: "active",
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationYaw: 0,
    rotationPitch: 0,
    joinedAt: ctx.timestamp,
    lastSeenAt: ctx.timestamp,
  });
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

function assertPublicCreationGuardrails(
  ctx: BackendCtx,
  world: ReturnType<typeof requireWorld>,
  playerIdentity: BackendCtx["sender"],
  {
    includePendingJobs,
  }: {
    includePendingJobs: boolean;
  },
) {
  if (world.visibility !== "public") {
    return;
  }

  if (
    includePendingJobs &&
    pendingCreateJobsForPlayer(ctx, world.worldId, playerIdentity) >=
      world.maxPendingCreateJobsPerPlayer
  ) {
    throw new SenderError("player has too many pending creation jobs");
  }

  if (liveObjectsInWorld(ctx, world.worldId) >= world.maxLiveObjects) {
    throw new SenderError("public world object cap reached");
  }

  if (
    liveObjectsCreatedByPlayer(ctx, world.worldId, playerIdentity) >=
    world.maxObjectsPerPlayer
  ) {
    throw new SenderError("player public object cap reached");
  }
}

function pendingCreateJobsForPlayer(
  ctx: BackendCtx,
  worldId: bigint,
  playerIdentity: BackendCtx["sender"],
) {
  let count = 0;
  for (const job of ctx.db.aiJob.iter()) {
    if (
      job.worldId === worldId &&
      job.jobType === "create" &&
      job.status === "pending" &&
      sameIdentity(job.playerIdentity, playerIdentity)
    ) {
      count += 1;
    }
  }
  return count;
}

function liveObjectsInWorld(ctx: BackendCtx, worldId: bigint) {
  let count = 0;
  for (const object of ctx.db.worldObject.iter()) {
    if (object.worldId === worldId && isLiveObjectState(object.state)) {
      count += 1;
    }
  }
  return count;
}

function liveObjectsCreatedByPlayer(
  ctx: BackendCtx,
  worldId: bigint,
  playerIdentity: BackendCtx["sender"],
) {
  let count = 0;
  for (const object of ctx.db.worldObject.iter()) {
    if (
      object.worldId === worldId &&
      isLiveObjectState(object.state) &&
      sameIdentity(object.createdBy, playerIdentity)
    ) {
      count += 1;
    }
  }
  return count;
}

function isLiveObjectState(state: string) {
  return (
    state === "draft" ||
    state === "grace" ||
    state === "public" ||
    state === "edit_locked" ||
    state === "cooldown"
  );
}

function assertCanManageWorldLifecycle(
  player: ReturnType<typeof requireActivePlayer>,
) {
  if (!canManageWorldLifecycle(player)) {
    throw new SenderError(
      "only a host or moderator can snapshot or reset this world",
    );
  }
}

function canManageWorldLifecycle(
  player: ReturnType<typeof requireActivePlayer>,
) {
  return (
    player.role === "host" ||
    player.role === "moderator" ||
    player.role === "platform_admin"
  );
}

function assertCanFailAiJob(
  player: ReturnType<typeof requireActivePlayer>,
  job: ReturnType<typeof requireAiJob>,
  sender: BackendCtx["sender"],
) {
  if (job.worldId !== player.worldId) {
    throw new SenderError("AI job is not in the active player world");
  }
  if (
    !sameIdentity(job.playerIdentity, sender) &&
    !canManageWorldLifecycle(player)
  ) {
    throw new SenderError(
      "only the job owner or world staff can fail this AI job",
    );
  }
}

function assertPendingAiJob(job: ReturnType<typeof requireAiJob>) {
  if (job.status !== "pending") {
    throw new SenderError("AI job is not pending");
  }
}

function createWorldSnapshot(
  ctx: BackendCtx,
  {
    world,
    snapshotId,
    reason,
  }: {
    world: ReturnType<typeof requireWorld>;
    snapshotId: string;
    reason: string;
  },
) {
  const normalizedSnapshotId = normalizeId("snapshotId", snapshotId);
  const normalizedReason = normalizeSnapshotReason(reason);

  if (ctx.db.worldSnapshot.snapshotId.find(normalizedSnapshotId)) {
    throw new SenderError("world snapshot already exists");
  }

  const cycleNumber = nextSnapshotCycleNumber(ctx, world.worldId);
  ctx.db.worldSnapshot.insert({
    snapshotId: normalizedSnapshotId,
    worldId: world.worldId,
    cycleNumber,
    reason: normalizedReason,
    createdAt: ctx.timestamp,
  });

  const liveObjects = Array.from(ctx.db.worldObject.iter()).filter(
    (object) =>
      object.worldId === world.worldId && isLiveObjectState(object.state),
  );
  liveObjects.forEach((object, index) => {
    const snapshotObjectId = normalizeSnapshotObjectId(
      `${normalizedSnapshotId}:object:${index + 1}`,
    );
    ctx.db.snapshotObject.insert({
      snapshotObjectId,
      snapshotId: normalizedSnapshotId,
      sourceObjectId: object.objectId,
      worldId: object.worldId,
      state: "archived",
      capturedState: object.state,
      version: object.version,
      createdBy: object.createdBy,
      latestEditor: object.latestEditor,
      category: object.category,
      sizeTier: object.sizeTier,
      sourceSpecJson: object.sourceSpecJson,
      builderSpecJson: object.builderSpecJson,
      positionX: object.positionX,
      positionY: object.positionY,
      positionZ: object.positionZ,
      rotationX: object.rotationX,
      rotationY: object.rotationY,
      rotationZ: object.rotationZ,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      scaleZ: object.scaleZ,
      capturedAt: ctx.timestamp,
    });
  });
}

function nextSnapshotCycleNumber(ctx: BackendCtx, worldId: bigint) {
  let maxCycleNumber = 0;
  for (const snapshot of ctx.db.worldSnapshot.iter()) {
    if (snapshot.worldId === worldId && snapshot.cycleNumber > maxCycleNumber) {
      maxCycleNumber = snapshot.cycleNumber;
    }
  }
  return maxCycleNumber + 1;
}

function deleteLiveWorldObjects(ctx: BackendCtx, worldId: bigint) {
  const liveObjects = Array.from(ctx.db.worldObject.iter()).filter(
    (object) => object.worldId === worldId && isLiveObjectState(object.state),
  );

  liveObjects.forEach((object) => {
    ctx.db.worldObject.objectId.update({
      ...object,
      state: "deleted",
      graceOwner: undefined,
      lockOwner: undefined,
      graceRemainingSeconds: 0,
      cooldownRemainingSeconds: 0,
      updatedAt: ctx.timestamp,
    });
    clearObjectLock(ctx, object.objectId);
  });
}

function failPendingWorldJobs(ctx: BackendCtx, worldId: bigint) {
  const pendingJobs = Array.from(ctx.db.aiJob.iter()).filter(
    (job) => job.worldId === worldId && job.status === "pending",
  );

  pendingJobs.forEach((job) => {
    ctx.db.aiJob.jobId.update({
      ...job,
      status: "failed",
      completedAt: ctx.timestamp,
      errorCode: "world_reset",
    });
  });
}

function normalizeHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

function isOwnerAdmin(ctx: BackendCtx): boolean {
  const sender = normalizeHex(ctx.sender.toHexString());
  return ownerAdminIdentities.some(
    (identity) => normalizeHex(identity) === sender,
  );
}

function bootstrapModeratorRole(ctx: BackendCtx): string | null {
  const sender = normalizeHex(ctx.sender.toHexString());
  return bootstrapModeratorIdentities.some(
    (identity) => normalizeHex(identity) === sender,
  )
    ? "moderator"
    : null;
}

function pruneChatHistory(ctx: BackendCtx, worldId: bigint) {
  const messages = Array.from(ctx.db.chatMessage.iter())
    .filter((message) => message.worldId === worldId)
    .sort((a, b) =>
      a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0,
    );
  const excess = messages.length - maxChatHistoryPerWorld;
  for (let i = 0; i < excess; i += 1) {
    ctx.db.chatMessage.messageId.delete(messages[i].messageId);
  }
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
    throw new SenderError(
      `invalid object state, expected ${expected} but got ${actual}`,
    );
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
    throw new SenderError(
      `${label} must be ${maxIdLength} characters or fewer`,
    );
  }
  return normalized;
}

function normalizeSnapshotObjectId(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new SenderError("snapshotObjectId is required");
  }
  if (normalized.length > maxSnapshotObjectIdLength) {
    throw new SenderError(
      `snapshotObjectId must be ${maxSnapshotObjectIdLength} characters or fewer`,
    );
  }
  return normalized;
}

function normalizeSnapshotReason(reason: string) {
  const normalized = reason.trim();
  if (normalized !== "manual_reset" && normalized !== "scheduled_reset") {
    throw new SenderError(
      "snapshot reason must be manual_reset or scheduled_reset",
    );
  }
  return normalized;
}

function normalizeWorldVisibility(visibility: string) {
  const normalized = visibility.trim();
  if (normalized !== "public" && normalized !== "private") {
    throw new SenderError("world visibility must be public or private");
  }
  return normalized;
}

function normalizeWorldName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new SenderError("world name is required");
  }
  if (normalized.length > maxWorldNameLength) {
    throw new SenderError(
      `world name must be ${maxWorldNameLength} characters or fewer`,
    );
  }
  return normalized;
}

function assertU32Range(
  label: string,
  value: number,
  min: number,
  max: number,
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SenderError(`${label} must be between ${min} and ${max}`);
  }
}

function normalizeAiJobErrorCode(errorCode: string) {
  const normalized = errorCode.trim();
  switch (normalized) {
    case "invalid_prompt":
    case "unsupported_request":
    case "unsafe_request":
    case "context_stale":
    case "generation_failed":
    case "validation_failed":
    case "timeout":
    case "world_reset":
      return normalized;
    default:
      throw new SenderError("AI job error code is not supported");
  }
}

function normalizeNickname(nickname: string) {
  const normalized = nickname.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new SenderError("nickname is required");
  }
  if (normalized.length > maxNicknameLength) {
    throw new SenderError(
      `nickname must be ${maxNicknameLength} characters or fewer`,
    );
  }
  return normalized;
}

function normalizeFeedbackText(label: string, value: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) {
    throw new SenderError(`${label} is required`);
  }
  if (normalized.length > maxLength) {
    throw new SenderError(`${label} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizePrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new SenderError("source prompt is required");
  }
  if (normalized.length > maxPromptLength) {
    throw new SenderError(
      `source prompt must be ${maxPromptLength} characters or fewer`,
    );
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
    throw new SenderError(
      "builder spec instance count does not match instances",
    );
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

function parseAvatarVoxelCoreJson(voxelCoreJson: string) {
  const normalizedJson = voxelCoreJson.trim();
  if (!normalizedJson) {
    throw new SenderError("avatar voxel core JSON is required");
  }
  if (normalizedJson.length > maxAvatarVoxelCoreJsonLength) {
    throw new SenderError(
      `avatar voxel core JSON must be ${maxAvatarVoxelCoreJsonLength} characters or fewer`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedJson);
  } catch {
    throw new SenderError("avatar voxel core JSON is malformed");
  }
  if (!isRecord(parsed)) {
    throw new SenderError("avatar voxel core must be an object");
  }

  return { normalizedJson };
}

function parseAvatarBuilderSpecJson(builderSpecJson: string) {
  const normalizedJson = builderSpecJson.trim();
  if (!normalizedJson) {
    throw new SenderError("avatar builder spec JSON is required");
  }
  if (normalizedJson.length > maxAvatarBuilderSpecJsonLength) {
    throw new SenderError(
      `avatar builder spec JSON must be ${maxAvatarBuilderSpecJsonLength} characters or fewer`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedJson);
  } catch {
    throw new SenderError("avatar builder spec JSON is malformed");
  }
  if (!isRecord(parsed)) {
    throw new SenderError("avatar builder spec must be an object");
  }

  const parts = readArrayField(parsed, "parts");
  if (!parts.length) {
    throw new SenderError("avatar builder spec parts must not be empty");
  }

  // Compiled bounds must fit the avatar clamp (≤ 2 × 3 × 2 units pre-normalization).
  // Each part contributes an AABB centered on its local_position (default origin)
  // and sized by its dimensions.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  parts.forEach((part, index) => {
    if (!isRecord(part)) {
      throw new SenderError(`avatar builder spec part ${index} must be an object`);
    }
    const dimensions = readNumberArrayField(part, "dimensions");
    const [dx, dy, dz] = dimensions as number[];
    const center = isVector3(part.local_position)
      ? (part.local_position as number[])
      : [0, 0, 0];
    minX = Math.min(minX, center[0] - dx / 2);
    maxX = Math.max(maxX, center[0] + dx / 2);
    minY = Math.min(minY, center[1] - dy / 2);
    maxY = Math.max(maxY, center[1] + dy / 2);
    minZ = Math.min(minZ, center[2] - dz / 2);
    maxZ = Math.max(maxZ, center[2] + dz / 2);
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const depth = maxZ - minZ;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth) ||
    width > avatarClampWidth ||
    height > avatarClampHeight ||
    depth > avatarClampDepth
  ) {
    throw new SenderError(
      `avatar exceeds the ${avatarClampWidth}x${avatarClampHeight}x${avatarClampDepth} size clamp`,
    );
  }

  return { normalizedJson };
}

function isVector3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
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
    throw new SenderError(
      "builder artifact operation does not match source spec",
    );
  }
  if (sourceSpec.category !== builderSpec.category) {
    throw new SenderError(
      "builder artifact category does not match source spec",
    );
  }
  if (sourceSpec.sizeTier !== builderSpec.sizeTier) {
    throw new SenderError(
      "builder artifact size tier does not match source spec",
    );
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

function readSourceNumberArrayField(
  value: Record<string, unknown>,
  field: string,
) {
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
    return allowMin
      ? value >= min && value <= max
      : value > min && value <= max;
  });

  if (!isValid) {
    throw new SenderError(`${label} must be within ${min} and ${max}`);
  }
}
