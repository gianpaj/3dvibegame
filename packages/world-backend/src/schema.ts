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
    destructiveEditsEnabled: t.bool(),
    objectCooldownSeconds: t.u32(),
    gracePeriodSeconds: t.u32(),
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
        accessor: "byWorldId",
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

export const AiJob = table(
  {
    name: "ai_job",
    public: true,
    indexes: [
      {
        name: "ai_job_world_id",
        accessor: "byWorldId",
        algorithm: "btree",
        columns: ["worldId"],
      },
      {
        name: "ai_job_player_identity",
        accessor: "byPlayerIdentity",
        algorithm: "btree",
        columns: ["playerIdentity"],
      },
    ],
  },
  {
    jobId: t.string().primaryKey(),
    worldId: t.u64(),
    playerIdentity: t.identity(),
    targetObjectId: t.string().optional(),
    jobType: t.string(),
    status: t.string(),
    sourcePrompt: t.string(),
    requestedAt: t.timestamp(),
    completedAt: t.timestamp().optional(),
    errorCode: t.string().optional(),
  },
);

export const WorldObject = table(
  {
    name: "world_object",
    public: true,
    indexes: [
      {
        name: "world_object_world_id",
        accessor: "byWorldId",
        algorithm: "btree",
        columns: ["worldId"],
      },
      {
        name: "world_object_state",
        accessor: "byState",
        algorithm: "btree",
        columns: ["state"],
      },
    ],
  },
  {
    objectId: t.string().primaryKey(),
    worldId: t.u64(),
    state: t.string(),
    version: t.u32(),
    createdBy: t.identity(),
    latestEditor: t.identity(),
    graceOwner: t.identity().optional(),
    lockOwner: t.identity().optional(),
    category: t.string(),
    sizeTier: t.string(),
    builderSpecJson: t.string(),
    positionX: t.f64(),
    positionY: t.f64(),
    positionZ: t.f64(),
    rotationX: t.f64(),
    rotationY: t.f64(),
    rotationZ: t.f64(),
    scaleX: t.f64(),
    scaleY: t.f64(),
    scaleZ: t.f64(),
    graceRemainingSeconds: t.u32(),
    cooldownRemainingSeconds: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

export const ObjectLock = table(
  {
    name: "object_lock",
    public: true,
    indexes: [
      {
        name: "object_lock_player_identity",
        accessor: "byPlayerIdentity",
        algorithm: "btree",
        columns: ["playerIdentity"],
      },
    ],
  },
  {
    objectId: t.string().primaryKey(),
    worldId: t.u64(),
    playerIdentity: t.identity(),
    lockType: t.string(),
    grantedAt: t.timestamp(),
    expiresAtMicros: t.i64().optional(),
  },
);

const spacetimedb = schema({
  world: World,
  playerSession: PlayerSession,
  aiJob: AiJob,
  worldObject: WorldObject,
  objectLock: ObjectLock,
});

export default spacetimedb;
