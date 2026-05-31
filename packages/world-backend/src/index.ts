import { SenderError, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";

import spacetimedb from "./schema";

const defaultWorldName = "Vibe Test Room";
const defaultWorldVisibility = "public";
const defaultMaxPlayers = 20;
const maxNicknameLength = 24;

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
      nickname: normalizedNickname,
      role: "player",
      presenceState: "active",
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
    presenceState: "active",
    lastSeenAt: ctx.timestamp,
  });
});

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
    presenceState: "disconnected",
    lastSeenAt: ctx.timestamp,
  });
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
