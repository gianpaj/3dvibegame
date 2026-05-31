import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";

import { DbConnection, type SubscriptionHandle } from "./module_bindings";
import type { PlayerSession, World } from "./module_bindings/types";
import { mapBackendAuthorityWorld } from "./mapBackendAuthorityWorld";

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
  dispose(): void;
}

export interface BackendRequestCreateObjectInput {
  jobId: string;
  sourcePrompt: string;
}

export interface BackendSubmitAiDraftInput {
  jobId: string;
  objectId: string;
  builderSpecJson: string;
}

export interface BackendObjectIdInput {
  objectId: string;
}

export interface BackendRequestEditLockInput extends BackendObjectIdInput {
  baseVersion: number;
}

export interface BackendSubmitObjectEditInput extends BackendRequestEditLockInput {
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
            "SELECT * FROM player_session",
            "SELECT * FROM world_object",
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

  connection.db.playerSession.onInsert(onPlayerInsert);
  connection.db.playerSession.onDelete(onPlayerDelete);
  connection.db.playerSession.onUpdate(onPlayerUpdate);
  connection.db.world.onInsert(onWorldInsert);
  connection.db.world.onDelete(onWorldDelete);
  connection.db.world.onUpdate(onWorldUpdate);
  connection.db.worldObject.onInsert(onWorldObjectInsert);
  connection.db.worldObject.onDelete(onWorldObjectDelete);
  connection.db.worldObject.onUpdate(onWorldObjectUpdate);

  return () => {
    connection.db.playerSession.removeOnInsert(onPlayerInsert);
    connection.db.playerSession.removeOnDelete(onPlayerDelete);
    connection.db.playerSession.removeOnUpdate(onPlayerUpdate);
    connection.db.world.removeOnInsert(onWorldInsert);
    connection.db.world.removeOnDelete(onWorldDelete);
    connection.db.world.removeOnUpdate(onWorldUpdate);
    connection.db.worldObject.removeOnInsert(onWorldObjectInsert);
    connection.db.worldObject.removeOnDelete(onWorldObjectDelete);
    connection.db.worldObject.removeOnUpdate(onWorldObjectUpdate);
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
  const players = Array.from(connection.db.playerSession.iter())
    .filter((player) => !world || player.worldId === world.worldId)
    .sort(comparePlayers)
    .map((player) => mapPlayer(player, localIdentityHex));
  const authorityWorld = world
    ? mapBackendAuthorityWorld(world, connection.db.worldObject.iter())
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
