import {
  appendPlayerTurn,
  buildConversationContext,
  classifyFollowUpIntent,
  createConversationThread,
  createAuthorityWorld,
  createSpecTemplateCache,
  discardDraft,
  expireCooldown,
  releaseEditLock,
  releaseObject,
  requestCreateObject,
  requestEditLock,
  submitAIDraft,
  submitObjectEdit,
  updateDraftTransform,
  updateLockedTransform,
  updateThreadActiveObject,
  type AuthorityWorld,
  type CompiledBuilderArtifact,
  type ConversationThread,
  type GenerationIntent,
  type GenerationStage,
  type GenerationStageEvent,
  type PriorSpecSummary,
  type VoxelSourceArtifact,
} from "@3dvibegame/scene-authority-ts";

import {
  resolveScenarioFromPrompt,
  scenarios,
  type LifecycleScenario,
  type ScenarioActionId,
  type ScenarioKey,
} from "../fixtures/scenarios";
import { demoEventBus } from "../events/bus";
import { buildSceneDocument, createEmptySceneDocument } from "../state";
import type { SceneDocument } from "../state";

// Shared across all sessions in the page — the cache persists as long as the tab is open.
// On a real backend this would be a server-side or distributed cache.
const specTemplateCache = createSpecTemplateCache();

export type GenerationActionId =
  | ScenarioActionId
  | "nudge_draft"
  | "rotate_draft"
  | "scale_draft"
  | "release_object";

export interface GenerationSnapshot {
  playerId: string;
  document: SceneDocument;
  sourcePrompt: string;
  stage: GenerationStage;
  matchedScenarioKey: ScenarioKey;
  matchedScenarioLabel: string;
  matchedScenarioDescription: string;
  world: AuthorityWorld;
  object: AuthorityWorld["objects"][number] | null;
  lastMessage: string;
  stageEvents: GenerationStageEvent[];
  plannedIntent: GenerationIntent | null;
  voxelArtifact: VoxelSourceArtifact | null;
  compiledArtifact: CompiledBuilderArtifact | null;
  availableActions: GenerationActionId[];
}

interface CachedObjectSession {
  source_prompt: string;
  matched_scenario_key: ScenarioKey;
  last_message: string;
  stage_events: GenerationStageEvent[];
  planned_intent: GenerationIntent | null;
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

interface CachedObjectArtifacts {
  voxel_artifact: VoxelSourceArtifact | null;
  compiled_artifact: CompiledBuilderArtifact | null;
  diagnostics: string[];
}

export function createGenerationSessionController(
  initialPrompt = scenarios.avatar_forge.sourcePrompt,
) {
  const playerId = "player_1";
  let world = buildInitialWorld();
  let document = createEmptySceneDocument(playerId);
  let activeObjectId: string | null = null;
  let sourcePrompt = initialPrompt;
  let stage: GenerationStage = "idle";
  let matchedScenarioKey = resolveScenarioFromPrompt(initialPrompt).key;
  let lastMessage = "Enter a prompt to generate the first avatar draft.";
  let stageEvents: GenerationStageEvent[] = [];
  let plannedIntent: GenerationIntent | null = null;
  let voxelArtifact: VoxelSourceArtifact | null = null;
  let compiledArtifact: CompiledBuilderArtifact | null = null;
  let objectArtifactsById: Record<string, CachedObjectArtifacts> = {};
  let objectSessionsById: Record<string, CachedObjectSession> = {};
  let conversationThread: ConversationThread = createConversationThread();
  let requestSequence = 0;
  let eventSequence = 0;
  let timers: number[] = [];
  let editLockTimer: number | null = null;
  const editLockDurationMs = 5_000;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): GenerationSnapshot {
      const scenario = scenarios[matchedScenarioKey];
      const currentObject = resolveCurrentObject();

      return {
        playerId,
        document,
        sourcePrompt,
        stage,
        matchedScenarioKey,
        matchedScenarioLabel: scenario.label,
        matchedScenarioDescription: scenario.description,
        world,
        object: currentObject,
        lastMessage,
        stageEvents,
        plannedIntent,
        voxelArtifact,
        compiledArtifact,
        availableActions: resolveAvailableActions(currentObject, scenario),
      };
    },
    submitPrompt(prompt: string) {
      const trimmed = prompt.trim();
      const activeObject = resolveCurrentObject();
      const hasActiveDraft = !!activeObject && activeObject.state === "grace";
      const priorSpecForPrompt = resolvePriorSpecSummary();

      const classified = classifyFollowUpIntent(trimmed, hasActiveDraft);

      if (classified.intent_class === "replace" && hasActiveDraft && activeObject) {
        try {
          const discarded = discardDraft(world, {
            objectId: activeObject.object_id,
            playerId,
          });
          world = discarded.world;
          pushStageEvent("failed", "Discarded draft to replace it.", "complete");
          conversationThread = updateThreadActiveObject(conversationThread, null);
        } catch (error) {
          // If discard fails because state changed, fall through and queue the new create.
        }
        activeObjectId = null;
      } else if (
        activeObject &&
        activeObject.state !== "public" &&
        activeObject.state !== "cooldown" &&
        classified.intent_class !== "replace"
      ) {
        // Block new prompts while a non-grace draft is in-flight, unless replacing.
        lastMessage = "Release or finish the current draft before starting another object.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      // Record this player turn in the thread before resetting session state.
      conversationThread = appendPlayerTurn(
        conversationThread,
        trimmed,
        classified.intent_class,
      );

      clearTimers();
      clearEditLockTimer();
      resetSessionState();

      if (!trimmed) {
        sourcePrompt = "";
        stage = "failed";
        lastMessage = "Prompt is empty. Enter a request to generate your avatar.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      requestSequence += 1;
      sourcePrompt = trimmed;
      matchedScenarioKey = resolveScenarioFromPrompt(trimmed).key;
      const scenario = scenarios[matchedScenarioKey];
      const jobId = `${scenario.jobId}_${requestSequence}`;
      const objectId = `${scenario.objectId}_${requestSequence}`;

      try {
        const queued = requestCreateObject(world, {
          jobId,
          playerId: scenario.creatorId,
          sourcePrompt: trimmed,
        });
        world = queued.world;
        stage = "queued";
        lastMessage = `Queued your avatar prompt and matched the ${scenario.label.toLowerCase()} recipe.`;
        pushStageEvent("queued", lastMessage, "complete");
        syncDocument();
        notify();

        schedule(320, () => {
          // Build prior spec summary from the most recently discarded/active object
          // so the AI can understand relative terms like "longer" or "a bus instead".
          const conversationContext =
            conversationThread.turns.length > 1
              ? buildConversationContext(
                  conversationThread,
                  classified.intent_class,
                  priorSpecForPrompt,
                )
              : null;

          plannedIntent = {
            ...scenario.plannedIntent,
            source_prompt: trimmed,
            conversation_context: conversationContext,
          };
          stage = "planning";
          lastMessage = `Structured the request into an ${plannedIntent.object_category} intent with ${plannedIntent.style_tags.join(", ")} style cues and ${plannedIntent.placement.mode} placement.`;
          if (classified.intent_class !== "create") {
            lastMessage += ` [${classified.intent_class}: ${classified.reason}]`;
          }
          pushStageEvent("planning", lastMessage, "complete");
          syncDocument();
          notify();
        });

        schedule(880, () => {
          const intent = plannedIntent;
          const derivedSpec =
            intent &&
            specTemplateCache.deriveIfApplicable(
              intent.object_category,
              intent.size_tier,
              intent.style_tags,
              trimmed,
              `${jobId}::voxel_source`,
              `${jobId}::intent`,
            );

          if (derivedSpec) {
            // Cache hit: reuse the stored base shape and apply color/style overrides.
            // No AI worker call needed — the geometry is identical.
            voxelArtifact = {
              target: "voxel_source",
              summary: `cache:${intent!.object_category}:${intent!.size_tier} • ${derivedSpec.operations.length} ops`,
              payload: clonePayload(derivedSpec),
              diagnostics: [...derivedSpec.diagnostics],
            };
            stage = "voxel_source_ready";
            lastMessage = `Cache hit: derived avatar ${intent!.object_category} from stored template (${derivedSpec.operations.length} ops).`;
          } else {
            // Cache miss: use the fixture/AI worker path, then store for future reuse.
            specTemplateCache.store(scenario.voxelSource);
            voxelArtifact = {
              target: "voxel_source",
              summary: summarizeVoxelSource(scenario.voxelSource),
              payload: clonePayload(scenario.voxelSource),
              diagnostics: [...scenario.voxelSource.diagnostics],
            };
            stage = "voxel_source_ready";
            lastMessage = `Avatar voxel source ready with ${scenario.voxelSource.operations.length} ordered operations.`;
          }

          pushStageEvent("voxel_source_ready", lastMessage, "complete");
          syncDocument();
          notify();
        });

        schedule(1420, () => {
          compiledArtifact = {
            target: "builder_spec",
            summary: summarizeCompiledArtifact(scenario.draftBuilder),
            payload: clonePayload(scenario.draftBuilder),
            diagnostics: [...scenario.draftBuilder.diagnostics],
          };
          pushStageEvent(
            "compiled_artifact_ready",
            `Compiled the avatar draft into ${scenario.draftBuilder.complexity.part_count} runtime parts.`,
            "complete",
          );

          const drafted = submitAIDraft(world, {
            jobId,
            objectId,
            creatorId: scenario.creatorId,
            builderSpec: scenario.draftBuilder,
            graceSeconds: scenario.graceSeconds,
          });
          world = drafted.world;
          activeObjectId = objectId;
          conversationThread = updateThreadActiveObject(conversationThread, objectId);
          objectArtifactsById[objectId] = {
            voxel_artifact: voxelArtifact,
            compiled_artifact: compiledArtifact,
            diagnostics: [
              ...(voxelArtifact?.diagnostics ?? []),
              ...(compiledArtifact?.diagnostics ?? []),
            ],
          };

          stage = "grace";
          lastMessage = "Avatar draft is ready for inspection in the studio preview.";
          pushStageEvent("grace", lastMessage, "complete");
          syncDocument();
          notify();
        });
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
      }
    },
    dispatch(actionId: GenerationActionId) {
      const object = resolveCurrentObject();
      const scenario = scenarios[matchedScenarioKey];

      if (!object) {
        lastMessage = "Generate an avatar first before editing or submitting a refine step.";
        syncDocument();
        notify();
        return;
      }

      const nextStep = scenario.refineSteps.find((step) => step.actionId === actionId);

      if (nextStep) {
        const expectedRefineAction = scenario.refineSteps[object.version - 1]?.actionId;

        if (expectedRefineAction !== actionId || object.state !== "public") {
          lastMessage = "That refine step is not currently available for this avatar version.";
          pushStageEvent("failed", lastMessage, "error");
          syncDocument();
          notify();
          return;
        }

        try {
          clearEditLockTimer();
          hydrateObjectSession(object.object_id);

          const locked = requestEditLock(world, {
            objectId: object.object_id,
            playerId,
            baseVersion: object.version,
          });
          world = locked.world;
          stage = "edit_locked";
          lastMessage = `Locked avatar version ${object.version} for ${nextStep.label.toLowerCase()}.`;
          pushStageEvent("edit_locked", lastMessage, "complete");

          const boundVoxel = createBoundVoxelArtifact(nextStep, object);
          const boundCompiled = createBoundCompiledArtifact(nextStep, object);

          voxelArtifact = boundVoxel;
          compiledArtifact = boundCompiled;

          const submitted = submitObjectEdit(world, {
            objectId: object.object_id,
            playerId,
            baseVersion: object.version,
            builderSpec: boundCompiled.payload,
          });
          world = submitted.world;
          objectArtifactsById[object.object_id] = {
            voxel_artifact: boundVoxel,
            compiled_artifact: boundCompiled,
            diagnostics: [
              ...boundVoxel.diagnostics,
              ...boundCompiled.diagnostics,
            ],
          };
          stage = "cooldown";
          lastMessage = `${nextStep.label} accepted as avatar version ${object.version + 1}.`;
          pushStageEvent("cooldown", submitted.event.message, "complete");

          const cooledDown = expireCooldown(world, {
            objectId: object.object_id,
          });
          world = cooledDown.world;
          stage = "released";
          lastMessage = `Avatar version ${object.version + 1} is now public and ready for the next refine step.`;
          pushStageEvent("released", cooledDown.event.message, "complete");
          persistArtifactsForObject(object.object_id);
        } catch (error) {
          stage = "failed";
          lastMessage = error instanceof Error ? error.message : String(error);
          pushStageEvent("failed", lastMessage, "error");
        }

        syncDocument();
        notify();
        return;
      }

      if (!isTransformAction(actionId)) {
        lastMessage = "That action is not currently available for this avatar.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      try {
        const editableObject = ensureEditableObject(object, actionId);
        if (!editableObject) {
          pushStageEvent("failed", lastMessage, "error");
          syncDocument();
          notify();
          return;
        }

        switch (actionId) {
          case "nudge_draft": {
            const patch = {
              position: {
                x: editableObject.transform.position[0] + 0.45,
                z: editableObject.transform.position[2] - 0.3,
              },
            };
            const result =
              editableObject.state === "edit_locked"
                ? updateLockedTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  })
                : updateDraftTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  });
            world = result.world;
            lastMessage =
              editableObject.state === "edit_locked"
                ? "Moved the selected avatar during the edit lock."
                : "Moved the draft within the grace window.";
            pushStageEvent(
              editableObject.state === "edit_locked" ? "edit_locked" : "grace",
              lastMessage,
              "complete",
            );
            refreshEditLock(editableObject);
            break;
          }
          case "rotate_draft": {
            const patch = {
              rotation: {
                y: editableObject.transform.rotation[1] + Math.PI / 8,
              },
            };
            const result =
              editableObject.state === "edit_locked"
                ? updateLockedTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  })
                : updateDraftTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  });
            world = result.world;
            lastMessage =
              editableObject.state === "edit_locked"
                ? "Rotated the selected avatar during the edit lock."
                : "Rotated the draft to inspect its silhouette before release.";
            pushStageEvent(
              editableObject.state === "edit_locked" ? "edit_locked" : "grace",
              lastMessage,
              "complete",
            );
            refreshEditLock(editableObject);
            break;
          }
          case "scale_draft": {
            const patch = {
              scale: {
                x: editableObject.transform.scale[0] * 1.12,
                y: editableObject.transform.scale[1] * 1.12,
                z: editableObject.transform.scale[2] * 1.12,
              },
            };
            const result =
              editableObject.state === "edit_locked"
                ? updateLockedTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  })
                : updateDraftTransform(world, {
                    objectId: editableObject.object_id,
                    playerId,
                    patch,
                  });
            world = result.world;
            lastMessage =
              editableObject.state === "edit_locked"
                ? "Scaled the selected avatar during the edit lock."
                : "Scaled the draft up during grace.";
            pushStageEvent(
              editableObject.state === "edit_locked" ? "edit_locked" : "grace",
              lastMessage,
              "complete",
            );
            refreshEditLock(editableObject);
            break;
          }
          case "release_object": {
            const result =
              editableObject.state === "edit_locked"
                ? releaseEditLock(world, {
                    objectId: editableObject.object_id,
                    playerId,
                  })
                : releaseObject(world, {
                    objectId: editableObject.object_id,
                    playerId,
                  });
            world = result.world;
            stage = "released";
            lastMessage =
              editableObject.state === "edit_locked"
                ? result.event.message
                : "Published avatar version 1 to the player profile.";
            activeObjectId = editableObject.object_id;
            clearEditLockTimer();
            pushStageEvent("released", lastMessage, "complete");
            persistArtifactsForObject(editableObject.object_id);
            break;
          }
          default:
            lastMessage = "That action is not currently available for this avatar.";
            pushStageEvent("failed", lastMessage, "error");
        }
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      }

      syncDocument();
      notify();
    },
    selectObject(objectId: string) {
      const object = world.objects.find((candidate) => candidate.object_id === objectId);
      const currentObject = resolveCurrentObject();

      if (!object) {
        lastMessage = `Object not found: ${objectId}`;
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      if (
        currentObject &&
        currentObject.object_id !== objectId &&
        currentObject.state !== "public" &&
        currentObject.state !== "cooldown"
      ) {
        lastMessage = "Release or finish the current draft before editing another object.";
        pushStageEvent("failed", lastMessage, "error");
        syncDocument();
        notify();
        return;
      }

      try {
        hydrateObjectSession(object.object_id);

        if (object.state === "edit_locked" && object.lock_owner_id === playerId) {
          stage = "edit_locked";
          lastMessage = "Resumed the current edit session.";
          activeObjectId = object.object_id;
          refreshEditLock(object);
        } else {
          stage = object.state === "grace" ? "grace" : "released";
          lastMessage =
            object.state === "cooldown"
              ? "Object is in cooldown and can be inspected but not edited."
              : `Selected ${object.builder_spec.object_category} for inspection.`;
          activeObjectId = object.object_id;
          clearEditLockTimer();
        }
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      }

      syncDocument();
      notify();
    },
    deselectObject() {
      const object = resolveCurrentObject();

      try {
        if (object?.state === "edit_locked" && object.lock_owner_id === playerId) {
          const result = releaseEditLock(world, {
            objectId: object.object_id,
            playerId,
          });
          world = result.world;
          lastMessage = result.event.message;
          pushStageEvent("released", lastMessage, "complete");
        } else {
          lastMessage = "Cleared object selection.";
        }

        activeObjectId = null;
        stage = world.objects.length ? "released" : "idle";
        clearEditLockTimer();
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      }

      syncDocument();
      notify();
    },
    dispose() {
      clearTimers();
      clearEditLockTimer();
      listeners.clear();
    },
    beginHistoryBatch(batchId: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session) return;
      session.history.active_batch_id = batchId;
      notify();
    },
    commitHistoryBatch(batchId: string, label: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session) return;
      session.history.active_batch_id = null;
      session.history.entries = [
        {
          entry_id: batchId,
          label,
        },
        ...session.history.entries,
      ].slice(0, 20);
      notify();
    },
    cancelHistoryBatch(batchId: string) {
      const session = document.player_sessions_by_id[playerId];
      if (!session || session.history.active_batch_id !== batchId) return;
      session.history.active_batch_id = null;
      notify();
    },
  };

  function resetSessionState() {
    world = buildInitialWorld();
    document = createEmptySceneDocument(
      playerId,
      document.player_sessions_by_id[playerId] ?? null,
    );
    activeObjectId = null;
    plannedIntent = null;
    voxelArtifact = null;
    compiledArtifact = null;
    stageEvents = [];
    objectArtifactsById = {};
    objectSessionsById = {};
    stage = "idle";
    lastMessage = "Enter a prompt to generate the first avatar draft.";
  }

  function schedule(delayMs: number, callback: () => void) {
    const timer = window.setTimeout(() => {
      timers = timers.filter((candidate) => candidate !== timer);
      callback();
    }, delayMs);
    timers.push(timer);
  }

  function clearTimers() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  }

  function clearEditLockTimer() {
    if (editLockTimer === null) return;
    window.clearTimeout(editLockTimer);
    editLockTimer = null;
  }

  function pushStageEvent(
    nextStage: GenerationStage,
    message: string,
    status: GenerationStageEvent["status"],
  ) {
    eventSequence += 1;
    stageEvents = [
      ...stageEvents,
      {
        id: `stage_event_${eventSequence}`,
        stage: nextStage,
        message,
        status,
        timestamp: new Date().toISOString(),
      },
    ].slice(-12);
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function syncDocument() {
    persistActiveObjectSession();

    const previousStage = document.player_sessions_by_id[playerId]?.generation_session?.stage;
    const previousFocusTarget =
      document.player_sessions_by_id[playerId]?.focus_target_object_id ?? null;

    document = buildSceneDocument({
      activeObjectId,
      selectedObjectId: activeObjectId,
      focusTargetObjectId: activeObjectId,
      objectArtifactsById,
      previousDocument: document,
      playerId,
      world,
      stage,
      matchedScenarioKey,
      lastMessage,
      stageEvents,
      plannedIntent,
      voxelArtifact,
      compiledArtifact,
      availableActions: resolveAvailableActions(
        resolveCurrentObject(),
        scenarios[matchedScenarioKey],
      ),
    });

    const nextFocusTarget =
      document.player_sessions_by_id[playerId]?.focus_target_object_id ?? null;
    const nextObjectId = activeObjectId ?? nextFocusTarget;

    if (previousStage !== stage) {
      demoEventBus.emit("generation:stage-changed", {
        player_id: playerId,
        stage,
        object_id: nextObjectId,
      });
    }

    if (previousFocusTarget !== nextFocusTarget) {
      demoEventBus.emit("viewer:focus-object", {
        player_id: playerId,
        object_id: nextFocusTarget,
      });
      demoEventBus.emit("object:selected", {
        player_id: playerId,
        object_id: nextFocusTarget,
      });
    }
  }

  function resolveCurrentObject() {
    if (!activeObjectId) {
      return null;
    }

    return world.objects.find((object) => object.object_id === activeObjectId) ?? null;
  }

  function hydrateObjectSession(objectId: string) {
    const cached = objectSessionsById[objectId];
    if (!cached) {
      return;
    }

    sourcePrompt = cached.source_prompt;
    matchedScenarioKey = cached.matched_scenario_key;
    lastMessage = cached.last_message;
    stageEvents = cached.stage_events;
    plannedIntent = cached.planned_intent;
    voxelArtifact = cached.voxel_artifact;
    compiledArtifact = cached.compiled_artifact;
  }

  function persistActiveObjectSession() {
    if (!activeObjectId) {
      return;
    }

    const diagnostics = objectArtifactsById[activeObjectId]?.diagnostics ?? [];
    objectSessionsById[activeObjectId] = {
      source_prompt: sourcePrompt,
      matched_scenario_key: matchedScenarioKey,
      last_message: lastMessage,
      stage_events: stageEvents,
      planned_intent: plannedIntent,
      voxel_artifact: voxelArtifact,
      compiled_artifact: compiledArtifact,
      diagnostics,
    };
  }

  function persistArtifactsForObject(objectId: string) {
    const diagnostics = objectArtifactsById[objectId]?.diagnostics ?? [];
    objectSessionsById[objectId] = {
      source_prompt: sourcePrompt,
      matched_scenario_key: matchedScenarioKey,
      last_message: lastMessage,
      stage_events: stageEvents,
      planned_intent: plannedIntent,
      voxel_artifact: voxelArtifact,
      compiled_artifact: compiledArtifact,
      diagnostics,
    };
  }

  function ensureEditableObject(
    object: AuthorityWorld["objects"][number],
    actionId: GenerationActionId,
  ) {
    if (object.state === "grace" || object.state === "edit_locked") {
      return object;
    }

    if (object.state === "public") {
      if (actionId === "release_object") {
        lastMessage = "Select Move, Rotate, or Scale to acquire an edit lock first.";
        return null;
      }

      const locked = requestEditLock(world, {
        objectId: object.object_id,
        playerId,
        baseVersion: object.version,
      });
      world = locked.world;
      stage = "edit_locked";
      lastMessage = locked.event.message;
      pushStageEvent("edit_locked", lastMessage, "complete");
      refreshEditLock(object);
      return resolveCurrentObject();
    }

    lastMessage =
      object.state === "cooldown"
        ? "Object is in cooldown and cannot be edited yet."
        : `Object is in ${object.state} state and cannot be edited.`;
    return null;
  }

  /**
   * Build a PriorSpecSummary from the most recently active object's voxel artifact.
   * Used to give the AI context like "the previous thing was a small red barrel" so
   * "longer" or "a bus instead" is interpreted relative to something concrete.
   */
  function resolvePriorSpecSummary(): PriorSpecSummary | null {
    const recentObjectId =
      activeObjectId ??
      Object.keys(objectArtifactsById).at(-1) ??
      null;
    if (!recentObjectId) return null;

    const artifacts = objectArtifactsById[recentObjectId];
    const voxelSpec = artifacts?.voxel_artifact?.payload;
    if (!voxelSpec) return null;

    return {
      object_category: voxelSpec.object_category,
      size_tier: voxelSpec.size_tier,
      style_tags: [...voxelSpec.style_tags],
      behaviors: [...voxelSpec.behaviors],
    };
  }

  function refreshEditLock(object: AuthorityWorld["objects"][number]) {
    if (object.state !== "edit_locked" && object.state !== "public") {
      return;
    }

    clearEditLockTimer();
    editLockTimer = window.setTimeout(() => {
      const currentObject = resolveCurrentObject();
      if (!currentObject || currentObject.state !== "edit_locked" || currentObject.lock_owner_id !== playerId) {
        editLockTimer = null;
        return;
      }

      try {
        const result = releaseEditLock(world, {
          objectId: currentObject.object_id,
          playerId,
        });
        world = result.world;
        stage = "released";
        lastMessage = "Edit lock expired after 5 seconds of inactivity.";
        pushStageEvent("released", lastMessage, "complete");
      } catch (error) {
        stage = "failed";
        lastMessage = error instanceof Error ? error.message : String(error);
        pushStageEvent("failed", lastMessage, "error");
      } finally {
        editLockTimer = null;
        syncDocument();
        notify();
      }
    }, editLockDurationMs);
  }
}

function buildInitialWorld(): AuthorityWorld {
  return createAuthorityWorld({
    worldId: "avatar_fixture_authority",
    settings: {
      visibility: "private",
      destructive_edits_enabled: false,
      object_cooldown_seconds: 3,
      protected_spawn_enabled: true,
    },
  });
}

function resolveAvailableActions(
  object: AuthorityWorld["objects"][number] | null,
  scenario: LifecycleScenario,
): GenerationActionId[] {
  if (!object) {
    return [];
  }

  if (object.state === "grace" || object.state === "edit_locked") {
    return ["nudge_draft", "rotate_draft", "scale_draft", "release_object"];
  }

  if (object.state !== "public") {
    return [];
  }

  const nextStep = scenario.refineSteps[object.version - 1];
  return nextStep ? [nextStep.actionId] : ["nudge_draft", "rotate_draft", "scale_draft"];
}

function isTransformAction(
  actionId: GenerationActionId,
): actionId is Exclude<GenerationActionId, ScenarioActionId> {
  return (
    actionId === "nudge_draft" ||
    actionId === "rotate_draft" ||
    actionId === "scale_draft" ||
    actionId === "release_object"
  );
}

function summarizeVoxelSource(spec: LifecycleScenario["voxelSource"]) {
  return [
    `${spec.operations.length} ops`,
    `${spec.materials.length} materials`,
    `${spec.placement.mode} placement`,
  ].join(" • ");
}

function summarizeCompiledArtifact(builder: LifecycleScenario["draftBuilder"]) {
  return [
    `${builder.complexity.part_count} parts`,
    `${builder.complexity.instance_count} instances`,
    `${builder.materials.length} materials`,
  ].join(" • ");
}

function createBoundVoxelArtifact(
  step: LifecycleScenario["refineSteps"][number],
  object: NonNullable<AuthorityWorld["objects"][number]>,
): VoxelSourceArtifact {
  const payload = clonePayload(step.voxelSource);
  payload.target_object_id = object.object_id;
  payload.base_object_version = object.version;

  return {
    target: "voxel_source",
    summary: summarizeVoxelSource(payload),
    payload,
    diagnostics: [...payload.diagnostics],
  };
}

function createBoundCompiledArtifact(
  step: LifecycleScenario["refineSteps"][number],
  object: NonNullable<AuthorityWorld["objects"][number]>,
): CompiledBuilderArtifact {
  const payload = clonePayload(step.builderSpec);
  payload.target_object_id = object.object_id;
  payload.base_object_version = object.version;

  return {
    target: "builder_spec",
    summary: summarizeCompiledArtifact(payload),
    payload,
    diagnostics: [...payload.diagnostics],
  };
}

function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
