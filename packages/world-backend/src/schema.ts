import { schema, table, t } from "spacetimedb/server";

export const World = table(
  {
    name: "world",
    public: true,
  },
  {
    worldId: t.u64().primaryKey().autoInc(),
    name: t.string(),
    visibility: t.string(),
    maxPlayers: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

export const PlayerSession = table(
  {
    name: "player_session",
    public: true,
    indexes: [
      {
        name: "player_session_world_id",
        algorithm: "btree",
        columns: ["worldId"],
      },
    ],
  },
  {
    identity: t.identity().primaryKey(),
    worldId: t.u64(),
    connectionId: t.connectionId().optional(),
    nickname: t.string(),
    role: t.string(),
    presenceState: t.string(),
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
    rotationYaw: t.f64(),
    rotationPitch: t.f64(),
    joinedAt: t.timestamp(),
    lastSeenAt: t.timestamp(),
  },
);

const spacetimedb = schema({
  world: World,
  playerSession: PlayerSession,
});

export default spacetimedb;
