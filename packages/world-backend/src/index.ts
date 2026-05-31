import { SenderError, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";

import spacetimedb from "./schema";

const defaultWorldName = "Vibe Test Room";
const defaultWorldVisibility = "public";
const defaultMaxPlayers = 20;
const maxNicknameLength = 24;
const maxHorizontalDistance = 256;
const minPlayerY = -8;
const maxPlayerY = 128;
const maxPitchRadians = Math.PI / 2;

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

function assertFinite(label: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new SenderError(`${label} must be finite`);
  }
}

function normalizeAngle(value: number) {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
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
