import type { AuthorityWorld } from "@3dvibegame/scene-authority-ts";

import {
  buildSceneDocument,
  aiWorkerFailureCodeFromUnknown,
  aiWorkerFailureLabel,
  type GenerationActionId,
  type GenerationSnapshot,
} from "../core";
import type {
  BackendAiJobDebug,
  BackendPresenceSnapshot,
} from "./createBackendPresenceBridge";

type BackendAuthorityObject = AuthorityWorld["objects"][number];

export function createBackendGenerationSnapshot(
  backendSnapshot: BackendPresenceSnapshot,
  fallback: GenerationSnapshot,
  selectedObjectId: string | null = null,
): GenerationSnapshot {
  const world = visibleBackendWorld(backendSnapshot) ?? fallback.world;
  const object = selectBackendObject(backendSnapshot, selectedObjectId);
  const aiJob = object ? null : selectBackendAiJob(backendSnapshot);
  const stage = object ? stageForBackendObject(object) : stageForBackendAiJob(aiJob);
  const lastMessage = object
    ? backendMessageForObject(backendSnapshot, object)
    : backendMessageForAiJob(aiJob);
  const stageEvents = [
    {
      id: object
        ? `backend:${object.object_id}:${object.version}:${object.state}`
        : aiJob
          ? `backend-ai-job:${aiJob.jobId}:${aiJob.status}:${aiJob.errorCode ?? "none"}`
          : "backend:idle",
      stage,
      message: lastMessage,
      status: "complete" as const,
      timestamp: new Date().toISOString(),
    },
  ];
  const availableActions = backendAvailableActions(backendSnapshot, object);

  return {
    ...fallback,
    playerId: localBackendPlayerId(backendSnapshot) ?? fallback.playerId,
    document: buildSceneDocument({
      playerId: localBackendPlayerId(backendSnapshot) ?? fallback.playerId,
      world,
      stage,
      matchedScenarioKey: fallback.matchedScenarioKey,
      lastMessage,
      stageEvents,
      plannedIntent: null,
      voxelArtifact: null,
      compiledArtifact: null,
      availableActions,
      activeObjectId: object?.object_id ?? null,
      selectedObjectId: object?.object_id ?? null,
      previousDocument: fallback.document,
    }),
    stage,
    world,
    object,
    lastMessage,
    stageEvents,
    plannedIntent: null,
    voxelArtifact: null,
    compiledArtifact: null,
    availableActions,
  };
}

function selectBackendAiJob(
  backendSnapshot: BackendPresenceSnapshot,
): BackendAiJobDebug | null {
  const localPlayerId = localBackendPlayerId(backendSnapshot);
  const jobs = localPlayerId
    ? backendSnapshot.aiJobs.filter((job) => job.playerId === localPlayerId)
    : backendSnapshot.aiJobs;

  return (
    jobs.find((job) => job.status === "pending") ??
    jobs.find((job) => job.status === "failed") ??
    jobs[0] ??
    null
  );
}

export function selectBackendObject(
  backendSnapshot: BackendPresenceSnapshot,
  preferredObjectId: string | null = null,
): BackendAuthorityObject | null {
  const world = visibleBackendWorld(backendSnapshot);
  if (!world?.objects.length) return null;

  if (preferredObjectId) {
    const preferred = world.objects.find(
      (object) => object.object_id === preferredObjectId,
    );
    if (preferred) return preferred;
  }

  // With no explicit selection, only surface the local player's own in-progress
  // work (a fresh draft in grace, or an object they hold an edit lock on). Do NOT
  // auto-select an arbitrary public object — that made the card appear with a
  // released object the player never selected.
  const localPlayerId = localBackendPlayerId(backendSnapshot);
  const objects = [...world.objects].reverse();

  return (
    objects.find(
      (object) => object.state === "grace" && object.grace_owner_id === localPlayerId,
    ) ??
    objects.find(
      (object) =>
        object.state === "edit_locked" && object.lock_owner_id === localPlayerId,
    ) ??
    null
  );
}

function visibleBackendWorld(backendSnapshot: BackendPresenceSnapshot) {
  const liveWorld = backendSnapshot.authorityWorld;
  if (liveWorld?.objects.length) return liveWorld;
  return backendSnapshot.archiveAuthorityWorld ?? liveWorld;
}

export function localBackendPlayerId(backendSnapshot: BackendPresenceSnapshot) {
  return backendSnapshot.players.find((player) => player.isLocal)?.id ?? null;
}

export function backendAvailableActions(
  backendSnapshot: BackendPresenceSnapshot,
  object = selectBackendObject(backendSnapshot),
): GenerationActionId[] {
  if (!object) return [];

  const localPlayerId = localBackendPlayerId(backendSnapshot);
  const isGraceOwner = object.state === "grace" && object.grace_owner_id === localPlayerId;
  const isLockOwner =
    object.state === "edit_locked" && object.lock_owner_id === localPlayerId;

  if (isGraceOwner) {
    return ["nudge_draft", "rotate_draft", "release_object"];
  }

  if (isLockOwner) {
    return ["nudge_draft", "rotate_draft"];
  }

  if (object.state === "public") {
    return ["nudge_draft", "rotate_draft"];
  }

  return [];
}

function stageForBackendObject(
  object: BackendAuthorityObject,
): GenerationSnapshot["stage"] {
  switch (object.state) {
    case "draft":
    case "grace":
      return "grace";
    case "edit_locked":
      return "edit_locked";
    case "cooldown":
      return "cooldown";
    case "public":
    case "archived":
      return "released";
    case "deleted":
      return "failed";
    default:
      object.state satisfies never;
      return "failed";
  }
}

function stageForBackendAiJob(
  job: BackendAiJobDebug | null,
): GenerationSnapshot["stage"] {
  if (!job) return "idle";
  if (job.status === "pending") return "queued";
  if (job.status === "failed") return "failed";
  return "idle";
}

function backendMessageForObject(
  backendSnapshot: BackendPresenceSnapshot,
  object: BackendAuthorityObject | null,
) {
  if (!object) {
    return "Live room ready. Prompt Savi to create a backend object.";
  }

  const localPlayerId = localBackendPlayerId(backendSnapshot);

  switch (object.state) {
    case "draft":
    case "grace":
      return object.grace_owner_id === localPlayerId
        ? `Backend draft ready. ${object.grace_remaining_seconds}s remain in grace.`
        : `Backend draft is in another player's grace window for ${object.grace_remaining_seconds}s.`;
    case "edit_locked":
      return object.lock_owner_id === localPlayerId
        ? "Backend edit lock active. Submit or release the locked edit."
        : "Backend object is locked by another editor.";
    case "cooldown":
      return `Backend edit accepted. ${object.cooldown_remaining_seconds}s cooldown remain.`;
    case "public":
      return `Backend object version ${object.version} is public.`;
    case "archived":
      return `Backend object version ${object.version} is archived read-only.`;
    case "deleted":
      return "Backend object was deleted.";
    default:
      object.state satisfies never;
      return "Backend object state is unknown.";
  }
}

function backendMessageForAiJob(job: BackendAiJobDebug | null) {
  if (!job) {
    return "Live room ready. Prompt Savi to create a backend object.";
  }

  if (job.status === "pending") {
    return "Backend create request is waiting on the AI worker.";
  }

  if (job.status === "failed") {
    const label = aiWorkerFailureLabel(
      aiWorkerFailureCodeFromUnknown(job.errorCode),
    );
    return `${label} Try another prompt when ready.`;
  }

  return "Live room ready. Prompt Savi to create a backend object.";
}
