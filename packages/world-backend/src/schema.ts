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
    maxLiveObjects: t.u32(),
    maxObjectsPerPlayer: t.u32(),
    maxPendingCreateJobsPerPlayer: t.u32(),
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
    sourceSpecJson: t.string(),
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

export const WorldSnapshot = table(
  {
    name: "world_snapshot",
    public: true,
    indexes: [
      {
        name: "world_snapshot_world_id",
        accessor: "byWorldId",
        algorithm: "btree",
        columns: ["worldId"],
      },
    ],
  },
  {
    snapshotId: t.string().primaryKey(),
    worldId: t.u64(),
    cycleNumber: t.u32(),
    reason: t.string(),
    createdAt: t.timestamp(),
  },
);

export const SnapshotObject = table(
  {
    name: "snapshot_object",
    public: true,
    indexes: [
      {
        name: "snapshot_object_snapshot_id",
        accessor: "bySnapshotId",
        algorithm: "btree",
        columns: ["snapshotId"],
      },
      {
        name: "snapshot_object_world_id",
        accessor: "byWorldId",
        algorithm: "btree",
        columns: ["worldId"],
      },
    ],
  },
  {
    snapshotObjectId: t.string().primaryKey(),
    snapshotId: t.string(),
    sourceObjectId: t.string(),
    worldId: t.u64(),
    state: t.string(),
    capturedState: t.string(),
    version: t.u32(),
    createdBy: t.identity(),
    latestEditor: t.identity(),
    category: t.string(),
    sizeTier: t.string(),
    sourceSpecJson: t.string(),
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
    capturedAt: t.timestamp(),
  },
);

export const ChatMessage = table(
  {
    name: "chat_message",
    public: true,
    indexes: [
      {
        name: "chat_message_world_id",
        accessor: "byWorldId",
        algorithm: "btree",
        columns: ["worldId"],
      },
    ],
  },
  {
    messageId: t.u64().primaryKey().autoInc(),
    worldId: t.u64(),
    senderIdentity: t.identity(),
    // Denormalized so messages keep their author after the sender leaves the world.
    senderNickname: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  },
);

// Player ratings (👍/👎) on an AI create/edit. Not `public`: submit-only, never
// broadcast to clients. Each row snapshots the prompt + both spec JSONs + the model
// and prompt version so a rating stays analysable even after the object is later
// edited or deleted. Analysed offline via `spacetime sql`.
export const ObjectFeedback = table(
  {
    name: "object_feedback",
    indexes: [
      {
        name: "object_feedback_operation_id",
        accessor: "byOperationId",
        algorithm: "btree",
        columns: ["operationId"],
      },
    ],
  },
  {
    feedbackId: t.u64().primaryKey().autoInc(),
    worldId: t.u64(),
    objectId: t.string(),
    objectVersion: t.u32(),
    operationId: t.string(),
    operation: t.string(),
    rating: t.string(),
    sourcePrompt: t.string(),
    sourceSpecJson: t.string(),
    builderSpecJson: t.string(),
    modelId: t.string(),
    promptVersion: t.string(),
    playerIdentity: t.identity(),
    playerNickname: t.string(),
    createdAt: t.timestamp(),
  },
);

const spacetimedb = schema({
  world: World,
  playerSession: PlayerSession,
  aiJob: AiJob,
  worldObject: WorldObject,
  objectLock: ObjectLock,
  worldSnapshot: WorldSnapshot,
  snapshotObject: SnapshotObject,
  chatMessage: ChatMessage,
  objectFeedback: ObjectFeedback,
});

export default spacetimedb;
