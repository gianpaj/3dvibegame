import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";

import { DbConnection, type SubscriptionHandle } from "./module_bindings";
import type {
  AiJob,
  PlayerSession,
  SnapshotObject,
  World,
  WorldObject,
  WorldSnapshot,
} from "./module_bindings/types";
import {
  mapBackendArchiveAuthorityWorld,
  mapBackendAuthorityWorld,
} from "./mapBackendAuthorityWorld";

export type BackendPresenceStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface BackendPlayerPresence {
  id: string;
  nickname: string;
  role: string;
  presenceState: string;
  transform: BackendPlayerTransform;
  isLocal: boolean;
}

export interface BackendPlayerTransform {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYaw: number;
  rotationPitch: number;
}

export interface BackendWorldPresence {
  id: string;
  name: string;
  visibility: string;
  maxPlayers: number;
  maxLiveObjects: number;
  maxObjectsPerPlayer: number;
  maxPendingCreateJobsPerPlayer: number;
  destructiveEditsEnabled: boolean;
  objectCooldownSeconds: number;
  gracePeriodSeconds: number;
}

export interface BackendObjectArtifactDebug {
  objectId: string;
  state: string;
  version: number;
  sourceSpecJson: string;
  builderSpecJson: string;
}

export interface BackendWorldSnapshotDebug {
  snapshotId: string;
  worldId: string;
  cycleNumber: number;
  reason: string;
  createdAt: string;
}

export interface BackendSnapshotObjectDebug {
  snapshotObjectId: string;
  snapshotId: string;
  sourceObjectId: string;
  worldId: string;
  state: string;
  capturedState: string;
  version: number;
  category: string;
  sizeTier: string;
  capturedAt: string;
}

export interface BackendAiJobDebug {
  jobId: string;
  worldId: string;
  playerId: string;
  targetObjectId: string | null;
  jobType: string;
  status: string;
  sourcePrompt: string;
  requestedAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

export interface BackendPresenceSnapshot {
  enabled: boolean;
  status: BackendPresenceStatus;
  message: string;
  nickname: string;
  onlineCount: number;
  world: BackendWorldPresence | null;
  players: BackendPlayerPresence[];
  authorityWorld: AuthorityWorld | null;
  archiveAuthorityWorld: AuthorityWorld | null;
  objectArtifacts: BackendObjectArtifactDebug[];
  aiJobs: BackendAiJobDebug[];
  worldSnapshots: BackendWorldSnapshotDebug[];
  snapshotObjects: BackendSnapshotObjectDebug[];
}

interface BackendPresenceBridgeConfig {
  onSnapshot(snapshot: BackendPresenceSnapshot): void;
}

export interface BackendPresenceBridge {
  getSnapshot(): BackendPresenceSnapshot;
  updateLocalTransform(transform: BackendPlayerTransform): void;
  requestCreateObject(input: BackendRequestCreateObjectInput): Promise<void>;
  submitAiDraft(input: BackendSubmitAiDraftInput): Promise<void>;
  updateDraftTransform(input: BackendObjectTransformInput): Promise<void>;
  updateLockedTransform(input: BackendObjectTransformInput): Promise<void>;
  releaseObject(input: BackendObjectIdInput): Promise<void>;
  requestEditLock(input: BackendRequestEditLockInput): Promise<void>;
  submitObjectEdit(input: BackendSubmitObjectEditInput): Promise<void>;
  cancelEdit(input: BackendObjectIdInput): Promise<void>;
  expireCooldown(input: BackendObjectIdInput): Promise<void>;
  failAiJob(input: BackendFailAiJobInput): Promise<void>;
  expireAiJob(input: BackendAiJobIdInput): Promise<void>;
  updateWorldSettings(input: BackendUpdateWorldSettingsInput): Promise<void>;
  createSnapshot(input: BackendWorldSnapshotInput): Promise<void>;
  resetWorld(input: BackendWorldSnapshotInput): Promise<void>;
  dispose(): void;
}

export interface BackendRequestCreateObjectInput {
  jobId: string;
  sourcePrompt: string;
}

export interface BackendSubmitAiDraftInput {
  jobId: string;
  objectId: string;
  sourceSpecJson: string;
  builderSpecJson: string;
}

export interface BackendObjectIdInput {
  objectId: string;
}

export interface BackendAiJobIdInput {
  jobId: string;
}

export interface BackendFailAiJobInput extends BackendAiJobIdInput {
  errorCode: string;
}

export interface BackendUpdateWorldSettingsInput {
  visibility: string;
  maxPlayers: number;
  maxLiveObjects: number;
  maxObjectsPerPlayer: number;
  maxPendingCreateJobsPerPlayer: number;
  destructiveEditsEnabled: boolean;
  objectCooldownSeconds: number;
  gracePeriodSeconds: number;
}

export interface BackendWorldSnapshotInput {
  snapshotId: string;
  reason: string;
}

export interface BackendRequestEditLockInput extends BackendObjectIdInput {
  baseVersion: number;
}

export interface BackendSubmitObjectEditInput extends BackendRequestEditLockInput {
  sourceSpecJson: string;
  builderSpecJson: string;
}

export interface BackendObjectTransformInput extends BackendObjectIdInput {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

const tokenStorageKey = "vibe-world:spacetimedb-token";
const heartbeatMs = 15_000;
const movementThrottleMs = 180;
const movementEpsilon = 0.025;

export function createBackendPresenceBridge({
  onSnapshot,
}: BackendPresenceBridgeConfig): BackendPresenceBridge {
  const config = readBackendConfig();

  if (!config) {
    const snapshot = createBaseSnapshot({
      enabled: false,
      status: "disabled",
      message: "Local room",
      nickname: resolveNickname(),
    });
    onSnapshot(snapshot);
    return {
      getSnapshot: () => snapshot,
      updateLocalTransform() {},
      requestCreateObject: rejectDisabledBackend,
      submitAiDraft: rejectDisabledBackend,
      updateDraftTransform: rejectDisabledBackend,
      updateLockedTransform: rejectDisabledBackend,
      releaseObject: rejectDisabledBackend,
      requestEditLock: rejectDisabledBackend,
      submitObjectEdit: rejectDisabledBackend,
      cancelEdit: rejectDisabledBackend,
      expireCooldown: rejectDisabledBackend,
      failAiJob: rejectDisabledBackend,
      expireAiJob: rejectDisabledBackend,
      updateWorldSettings: rejectDisabledBackend,
      createSnapshot: rejectDisabledBackend,
      resetWorld: rejectDisabledBackend,
      dispose() {},
    };
  }
  const backendConfig = config;

  let disposed = false;
  let status: BackendPresenceStatus = "connecting";
  let message = `Connecting to ${backendConfig.database}`;
  let localIdentityHex: string | null = null;
  let connection: DbConnection | null = null;
  let subscription: SubscriptionHandle | null = null;
  let removeTableListeners: (() => void) | null = null;
  let heartbeatId: number | null = null;
  let movementTimeoutId: number | null = null;
  let lastMovementSentAt = 0;
  let lastQueuedTransform: BackendPlayerTransform | null = null;
  let pendingTransform: BackendPlayerTransform | null = null;
  let joined = false;

  let snapshot = createBaseSnapshot({
    enabled: true,
    status,
    message,
    nickname: backendConfig.nickname,
  });
  onSnapshot(snapshot);

  try {
    connection = DbConnection.builder()
      .withUri(backendConfig.uri)
      .withDatabaseName(backendConfig.database)
      .withToken(readToken())
      .onConnect((conn, identity, token) => {
        if (disposed) return;

        localIdentityHex = identity.toHexString();
        writeToken(token);
        status = "connected";
        message = "Connected. Loading room.";
        removeTableListeners = installTableListeners(conn, emitCurrent);

        subscription = conn
          .subscriptionBuilder()
          .onApplied(() => {
            if (disposed) return;
            status = "connected";
            message = "Live room joined.";
            emitCurrent();
            void conn.reducers
              .joinWorld({ nickname: backendConfig.nickname })
              .then(() => {
                if (disposed) return;
                joined = true;
                emitCurrent();
                flushPendingTransform();
              })
              .catch((error: unknown) => {
                if (!disposed) {
                  status = "error";
                  message = errorMessage(error, "Failed to join room");
                  emitCurrent();
                }
              });
            heartbeatId = window.setInterval(() => {
              void conn.reducers.heartbeatPlayer({}).catch(() => {
                if (!disposed) {
                  status = "disconnected";
                  message = "Heartbeat failed.";
                  emitCurrent();
                }
              });
            }, heartbeatMs);
          })
          .onError((ctx) => {
            if (disposed) return;
            status = "error";
            message = errorMessage(ctx.event, "Room subscription failed");
            emitCurrent();
          })
          .subscribe([
            "SELECT * FROM world",
            "SELECT * FROM ai_job",
            "SELECT * FROM player_session",
            "SELECT * FROM world_object",
            "SELECT * FROM world_snapshot",
            "SELECT * FROM snapshot_object",
          ]);
      })
      .onConnectError((_ctx, error) => {
        if (disposed) return;
        status = "error";
        message = errorMessage(error, "Backend connection failed");
        emitCurrent();
      })
      .onDisconnect((_ctx, error) => {
        if (disposed) return;
        status = "disconnected";
        message = errorMessage(error, "Backend disconnected");
        emitCurrent();
      })
      .build();
  } catch (error) {
    status = "error";
    message = errorMessage(error, "Backend connection failed");
    emitCurrent();
  }

  return {
    getSnapshot: () => snapshot,
    dispose() {
      disposed = true;
      if (heartbeatId !== null) {
        window.clearInterval(heartbeatId);
        heartbeatId = null;
      }
      if (movementTimeoutId !== null) {
        window.clearTimeout(movementTimeoutId);
        movementTimeoutId = null;
      }
      try {
        subscription?.unsubscribe();
      } catch {
        // The SDK rejects double/unapplied unsubscribe calls; disposal should continue.
      }
      removeTableListeners?.();
      if (connection?.isActive) {
        void connection.reducers.leaveWorld({}).finally(() => connection?.disconnect());
      } else {
        connection?.disconnect();
      }
    },
    updateLocalTransform(transform: BackendPlayerTransform) {
      if (disposed || !shouldQueueTransform(transform, lastQueuedTransform)) return;
      lastQueuedTransform = cloneTransform(transform);
      pendingTransform = cloneTransform(transform);

      const elapsed = window.performance.now() - lastMovementSentAt;
      if (elapsed >= movementThrottleMs) {
        flushPendingTransform();
        return;
      }

      if (movementTimeoutId === null) {
        movementTimeoutId = window.setTimeout(() => {
          movementTimeoutId = null;
          flushPendingTransform();
        }, movementThrottleMs - elapsed);
      }
    },
    requestCreateObject(input) {
      return callLiveReducer("Create request rejected", (conn) =>
        conn.reducers.requestCreateObject(input),
      );
    },
    submitAiDraft(input) {
      return callLiveReducer("Draft submit rejected", (conn) =>
        conn.reducers.submitAiDraft(input),
      );
    },
    updateDraftTransform(input) {
      return callLiveReducer("Draft transform rejected", (conn) =>
        conn.reducers.updateDraftTransform(input),
      );
    },
    updateLockedTransform(input) {
      return callLiveReducer("Locked transform rejected", (conn) =>
        conn.reducers.updateLockedTransform(input),
      );
    },
    releaseObject(input) {
      return callLiveReducer("Release rejected", (conn) =>
        conn.reducers.releaseObject(input),
      );
    },
    requestEditLock(input) {
      return callLiveReducer("Edit lock rejected", (conn) =>
        conn.reducers.requestEditLock(input),
      );
    },
    submitObjectEdit(input) {
      return callLiveReducer("Object edit rejected", (conn) =>
        conn.reducers.submitObjectEdit(input),
      );
    },
    cancelEdit(input) {
      return callLiveReducer("Edit cancel rejected", (conn) =>
        conn.reducers.cancelEdit(input),
      );
    },
    expireCooldown(input) {
      return callLiveReducer("Cooldown expiry rejected", (conn) =>
        conn.reducers.expireCooldown(input),
      );
    },
    failAiJob(input) {
      return callLiveReducer("AI job failure rejected", (conn) =>
        conn.reducers.failAiJob(input),
      );
    },
    expireAiJob(input) {
      return callLiveReducer("AI job expiry rejected", (conn) =>
        conn.reducers.expireAiJob(input),
      );
    },
    updateWorldSettings(input) {
      return callLiveReducer("World settings update rejected", (conn) =>
        conn.reducers.updateWorldSettings(input),
      );
    },
    createSnapshot(input) {
      return callLiveReducer("World snapshot rejected", (conn) =>
        conn.reducers.createSnapshot(input),
      );
    },
    resetWorld(input) {
      return callLiveReducer("World reset rejected", (conn) =>
        conn.reducers.resetWorld(input),
      );
    },
  };

  function emitCurrent() {
    if (disposed) return;
    snapshot = readSnapshotFromConnection({
      connection,
      enabled: true,
      status,
      message,
      nickname: backendConfig.nickname,
      localIdentityHex,
    });
    if (snapshot.players.some((player) => player.isLocal && player.presenceState === "active")) {
      joined = true;
    }
    onSnapshot(snapshot);
    flushPendingTransform();
  }

  function flushPendingTransform() {
    if (!pendingTransform || !joined || !connection?.isActive) return;

    const transform = pendingTransform;
    pendingTransform = null;
    lastMovementSentAt = window.performance.now();
    void connection.reducers.movePlayer(transform).catch((error: unknown) => {
      if (disposed) return;
      message = errorMessage(error, "Movement update rejected");
      emitCurrent();
    });
  }

  async function callLiveReducer(
    fallback: string,
    reducer: (conn: DbConnection) => Promise<unknown>,
  ) {
    if (disposed || !joined || !connection?.isActive) {
      throw new Error("Backend room is not ready yet.");
    }

    try {
      await reducer(connection);
    } catch (error) {
      message = errorMessage(error, fallback);
      emitCurrent();
      throw error;
    }
  }
}

function installTableListeners(connection: DbConnection, onChange: () => void) {
  const onAiJobInsert: Parameters<typeof connection.db.aiJob.onInsert>[0] = () =>
    onChange();
  const onAiJobDelete: Parameters<typeof connection.db.aiJob.onDelete>[0] = () =>
    onChange();
  const onAiJobUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.aiJob.onUpdate>>[0]
  > = () => onChange();

  const onPlayerInsert: Parameters<typeof connection.db.playerSession.onInsert>[0] =
    () => onChange();
  const onPlayerDelete: Parameters<typeof connection.db.playerSession.onDelete>[0] =
    () => onChange();
  const onPlayerUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.playerSession.onUpdate>>[0]
  > = () => onChange();

  const onWorldInsert: Parameters<typeof connection.db.world.onInsert>[0] = () =>
    onChange();
  const onWorldDelete: Parameters<typeof connection.db.world.onDelete>[0] = () =>
    onChange();
  const onWorldUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.world.onUpdate>>[0]
  > = () => onChange();
  const onWorldObjectInsert: Parameters<typeof connection.db.worldObject.onInsert>[0] =
    () => onChange();
  const onWorldObjectDelete: Parameters<typeof connection.db.worldObject.onDelete>[0] =
    () => onChange();
  const onWorldObjectUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.worldObject.onUpdate>>[0]
  > = () => onChange();
  const onWorldSnapshotInsert: Parameters<
    typeof connection.db.worldSnapshot.onInsert
  >[0] = () => onChange();
  const onWorldSnapshotDelete: Parameters<
    typeof connection.db.worldSnapshot.onDelete
  >[0] = () => onChange();
  const onWorldSnapshotUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.worldSnapshot.onUpdate>>[0]
  > = () => onChange();
  const onSnapshotObjectInsert: Parameters<
    typeof connection.db.snapshotObject.onInsert
  >[0] = () => onChange();
  const onSnapshotObjectDelete: Parameters<
    typeof connection.db.snapshotObject.onDelete
  >[0] = () => onChange();
  const onSnapshotObjectUpdate: NonNullable<
    Parameters<NonNullable<typeof connection.db.snapshotObject.onUpdate>>[0]
  > = () => onChange();

  connection.db.aiJob.onInsert(onAiJobInsert);
  connection.db.aiJob.onDelete(onAiJobDelete);
  connection.db.aiJob.onUpdate(onAiJobUpdate);
  connection.db.playerSession.onInsert(onPlayerInsert);
  connection.db.playerSession.onDelete(onPlayerDelete);
  connection.db.playerSession.onUpdate(onPlayerUpdate);
  connection.db.world.onInsert(onWorldInsert);
  connection.db.world.onDelete(onWorldDelete);
  connection.db.world.onUpdate(onWorldUpdate);
  connection.db.worldObject.onInsert(onWorldObjectInsert);
  connection.db.worldObject.onDelete(onWorldObjectDelete);
  connection.db.worldObject.onUpdate(onWorldObjectUpdate);
  connection.db.worldSnapshot.onInsert(onWorldSnapshotInsert);
  connection.db.worldSnapshot.onDelete(onWorldSnapshotDelete);
  connection.db.worldSnapshot.onUpdate(onWorldSnapshotUpdate);
  connection.db.snapshotObject.onInsert(onSnapshotObjectInsert);
  connection.db.snapshotObject.onDelete(onSnapshotObjectDelete);
  connection.db.snapshotObject.onUpdate(onSnapshotObjectUpdate);

  return () => {
    connection.db.aiJob.removeOnInsert(onAiJobInsert);
    connection.db.aiJob.removeOnDelete(onAiJobDelete);
    connection.db.aiJob.removeOnUpdate(onAiJobUpdate);
    connection.db.playerSession.removeOnInsert(onPlayerInsert);
    connection.db.playerSession.removeOnDelete(onPlayerDelete);
    connection.db.playerSession.removeOnUpdate(onPlayerUpdate);
    connection.db.world.removeOnInsert(onWorldInsert);
    connection.db.world.removeOnDelete(onWorldDelete);
    connection.db.world.removeOnUpdate(onWorldUpdate);
    connection.db.worldObject.removeOnInsert(onWorldObjectInsert);
    connection.db.worldObject.removeOnDelete(onWorldObjectDelete);
    connection.db.worldObject.removeOnUpdate(onWorldObjectUpdate);
    connection.db.worldSnapshot.removeOnInsert(onWorldSnapshotInsert);
    connection.db.worldSnapshot.removeOnDelete(onWorldSnapshotDelete);
    connection.db.worldSnapshot.removeOnUpdate(onWorldSnapshotUpdate);
    connection.db.snapshotObject.removeOnInsert(onSnapshotObjectInsert);
    connection.db.snapshotObject.removeOnDelete(onSnapshotObjectDelete);
    connection.db.snapshotObject.removeOnUpdate(onSnapshotObjectUpdate);
  };
}

function readSnapshotFromConnection({
  connection,
  enabled,
  status,
  message,
  nickname,
  localIdentityHex,
}: {
  connection: DbConnection | null;
  enabled: boolean;
  status: BackendPresenceStatus;
  message: string;
  nickname: string;
  localIdentityHex: string | null;
}): BackendPresenceSnapshot {
  if (!connection) {
    return createBaseSnapshot({ enabled, status, message, nickname });
  }

  const world = first(connection.db.world.iter());
  const worldObjects = world
    ? Array.from(connection.db.worldObject.iter()).filter(
        (object) => object.worldId === world.worldId,
      )
    : [];
  const aiJobs = world
    ? Array.from(connection.db.aiJob.iter())
        .filter((job) => job.worldId === world.worldId)
        .sort(compareAiJobs)
    : [];
  const worldSnapshots = world
    ? Array.from(connection.db.worldSnapshot.iter())
        .filter((snapshot) => snapshot.worldId === world.worldId)
        .sort(compareWorldSnapshots)
    : [];
  const snapshotObjects = world
    ? Array.from(connection.db.snapshotObject.iter())
        .filter((object) => object.worldId === world.worldId)
        .sort(compareSnapshotObjects)
    : [];
  const players = Array.from(connection.db.playerSession.iter())
    .filter((player) => !world || player.worldId === world.worldId)
    .sort(comparePlayers)
    .map((player) => mapPlayer(player, localIdentityHex));
  const authorityWorld = world ? mapBackendAuthorityWorld(world, worldObjects) : null;
  const archiveAuthorityWorld = world
    ? mapBackendArchiveAuthorityWorld(world, worldSnapshots[0] ?? null, snapshotObjects)
    : null;

  return {
    enabled,
    status,
    message,
    nickname,
    onlineCount: players.filter((player) => player.presenceState === "active").length,
    world: world ? mapWorld(world) : null,
    players,
    authorityWorld,
    archiveAuthorityWorld,
    objectArtifacts: worldObjects.map(mapObjectArtifactDebug),
    aiJobs: aiJobs.map(mapAiJobDebug),
    worldSnapshots: worldSnapshots.map(mapWorldSnapshotDebug),
    snapshotObjects: snapshotObjects.map(mapSnapshotObjectDebug),
  };
}

function createBaseSnapshot({
  enabled,
  status,
  message,
  nickname,
}: {
  enabled: boolean;
  status: BackendPresenceStatus;
  message: string;
  nickname: string;
}): BackendPresenceSnapshot {
  return {
    enabled,
    status,
    message,
    nickname,
    onlineCount: 0,
    world: null,
    players: [],
    authorityWorld: null,
    archiveAuthorityWorld: null,
    objectArtifacts: [],
    aiJobs: [],
    worldSnapshots: [],
    snapshotObjects: [],
  };
}

function readBackendConfig() {
  const uri = stringEnv("VITE_SPACETIMEDB_URI");
  const database = stringEnv("VITE_SPACETIMEDB_DATABASE");

  if (!uri || !database) {
    return null;
  }

  return {
    uri,
    database,
    nickname: resolveNickname(),
  };
}

function resolveNickname() {
  const nickname = stringEnv("VITE_PLAYER_NICKNAME") ?? "You";
  return nickname.trim().replace(/\s+/g, " ").slice(0, 24) || "You";
}

function stringEnv(key: string) {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readToken() {
  try {
    return window.localStorage.getItem(tokenStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string) {
  try {
    window.localStorage.setItem(tokenStorageKey, token);
  } catch {
    // Token persistence is optional; anonymous reconnect can still proceed.
  }
}

function first<T>(iterator: Iterable<T>) {
  for (const item of iterator) {
    return item;
  }
  return null;
}

function mapWorld(world: World): BackendWorldPresence {
  return {
    id: world.worldId.toString(),
    name: world.name,
    visibility: world.visibility,
    maxPlayers: world.maxPlayers,
    maxLiveObjects: world.maxLiveObjects,
    maxObjectsPerPlayer: world.maxObjectsPerPlayer,
    maxPendingCreateJobsPerPlayer: world.maxPendingCreateJobsPerPlayer,
    destructiveEditsEnabled: world.destructiveEditsEnabled,
    objectCooldownSeconds: world.objectCooldownSeconds,
    gracePeriodSeconds: world.gracePeriodSeconds,
  };
}

function mapPlayer(
  player: PlayerSession,
  localIdentityHex: string | null,
): BackendPlayerPresence {
  const id = player.identity.toHexString();
  return {
    id,
    nickname: player.nickname,
    role: player.role,
    presenceState: player.presenceState,
    transform: {
      positionX: player.positionX,
      positionY: player.positionY,
      positionZ: player.positionZ,
      rotationYaw: player.rotationYaw,
      rotationPitch: player.rotationPitch,
    },
    isLocal: localIdentityHex === id,
  };
}

function mapObjectArtifactDebug(object: WorldObject): BackendObjectArtifactDebug {
  return {
    objectId: object.objectId,
    state: object.state,
    version: object.version,
    sourceSpecJson: object.sourceSpecJson,
    builderSpecJson: object.builderSpecJson,
  };
}

function mapAiJobDebug(job: AiJob): BackendAiJobDebug {
  return {
    jobId: job.jobId,
    worldId: job.worldId.toString(),
    playerId: job.playerIdentity.toHexString(),
    targetObjectId: job.targetObjectId ?? null,
    jobType: job.jobType,
    status: job.status,
    sourcePrompt: job.sourcePrompt,
    requestedAt: job.requestedAt.toString(),
    completedAt: job.completedAt?.toString() ?? null,
    errorCode: job.errorCode ?? null,
  };
}

function mapWorldSnapshotDebug(
  snapshot: WorldSnapshot,
): BackendWorldSnapshotDebug {
  return {
    snapshotId: snapshot.snapshotId,
    worldId: snapshot.worldId.toString(),
    cycleNumber: snapshot.cycleNumber,
    reason: snapshot.reason,
    createdAt: snapshot.createdAt.toString(),
  };
}

function mapSnapshotObjectDebug(
  object: SnapshotObject,
): BackendSnapshotObjectDebug {
  return {
    snapshotObjectId: object.snapshotObjectId,
    snapshotId: object.snapshotId,
    sourceObjectId: object.sourceObjectId,
    worldId: object.worldId.toString(),
    state: object.state,
    capturedState: object.capturedState,
    version: object.version,
    category: object.category,
    sizeTier: object.sizeTier,
    capturedAt: object.capturedAt.toString(),
  };
}

function shouldQueueTransform(
  next: BackendPlayerTransform,
  previous: BackendPlayerTransform | null,
) {
  if (!previous) return true;

  return (
    Math.abs(next.positionX - previous.positionX) > movementEpsilon ||
    Math.abs(next.positionY - previous.positionY) > movementEpsilon ||
    Math.abs(next.positionZ - previous.positionZ) > movementEpsilon ||
    Math.abs(next.rotationYaw - previous.rotationYaw) > movementEpsilon ||
    Math.abs(next.rotationPitch - previous.rotationPitch) > movementEpsilon
  );
}

function cloneTransform(transform: BackendPlayerTransform): BackendPlayerTransform {
  return { ...transform };
}

function comparePlayers(a: PlayerSession, b: PlayerSession) {
  const stateDelta = playerStateWeight(a) - playerStateWeight(b);
  if (stateDelta !== 0) return stateDelta;
  return a.nickname.localeCompare(b.nickname);
}

function compareAiJobs(a: AiJob, b: AiJob) {
  return b.jobId.localeCompare(a.jobId);
}

function compareWorldSnapshots(a: WorldSnapshot, b: WorldSnapshot) {
  return b.cycleNumber - a.cycleNumber || b.snapshotId.localeCompare(a.snapshotId);
}

function compareSnapshotObjects(a: SnapshotObject, b: SnapshotObject) {
  return (
    b.snapshotId.localeCompare(a.snapshotId) ||
    a.sourceObjectId.localeCompare(b.sourceObjectId)
  );
}

function playerStateWeight(player: PlayerSession) {
  if (player.presenceState === "active") return 0;
  if (player.presenceState === "idle") return 1;
  return 2;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}

async function rejectDisabledBackend(): Promise<void> {
  throw new Error("Backend room is not configured.");
}
