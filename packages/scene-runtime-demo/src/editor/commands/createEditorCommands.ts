import { demoEventBus, type GenerationActionId, type GenerationSnapshot } from "../../core";

interface GenerationController {
  getSnapshot(): GenerationSnapshot;
  submitPrompt(prompt: string): void;
  dispatch(actionId: GenerationActionId): void;
  selectObject(objectId: string): void;
  deselectObject(): void;
  beginHistoryBatch(batchId: string): void;
  commitHistoryBatch(batchId: string, label: string): void;
}

export function createEditorCommands(generation: GenerationController) {
  return {
    submitPrompt(prompt: string) {
      const snapshot = generation.getSnapshot();
      const batchId = `batch_prompt_${Date.now()}`;
      const label = "submit_prompt";

      demoEventBus.emit("history:batch-started", {
        player_id: snapshot.playerId,
        batch_id: batchId,
        label,
      });
      demoEventBus.emit("generation:prompt-submitted", {
        player_id: snapshot.playerId,
        prompt,
      });
      demoEventBus.emit("tool:action-requested", {
        player_id: snapshot.playerId,
        action_id: label,
      });
      generation.beginHistoryBatch(batchId);

      generation.submitPrompt(prompt);
      generation.commitHistoryBatch(batchId, label);

      demoEventBus.emit("history:batch-committed", {
        player_id: snapshot.playerId,
        batch_id: batchId,
        label,
      });
    },
    dispatchAction(actionId: GenerationActionId) {
      const snapshot = generation.getSnapshot();
      const batchId = `batch_${actionId}_${Date.now()}`;

      demoEventBus.emit("history:batch-started", {
        player_id: snapshot.playerId,
        batch_id: batchId,
        label: actionId,
      });
      demoEventBus.emit("tool:action-requested", {
        player_id: snapshot.playerId,
        action_id: actionId,
      });
      generation.beginHistoryBatch(batchId);

      generation.dispatch(actionId);
      generation.commitHistoryBatch(batchId, actionId);

      demoEventBus.emit("history:batch-committed", {
        player_id: snapshot.playerId,
        batch_id: batchId,
        label: actionId,
      });
    },
    selectObject(objectId: string) {
      const snapshot = generation.getSnapshot();
      generation.selectObject(objectId);

      demoEventBus.emit("object:selected", {
        player_id: snapshot.playerId,
        object_id: objectId,
      });
      demoEventBus.emit("viewer:focus-object", {
        player_id: snapshot.playerId,
        object_id: objectId,
      });
    },
    deselectObject() {
      const snapshot = generation.getSnapshot();
      generation.deselectObject();

      demoEventBus.emit("object:selected", {
        player_id: snapshot.playerId,
        object_id: null,
      });
      demoEventBus.emit("viewer:focus-object", {
        player_id: snapshot.playerId,
        object_id: null,
      });
    },
  };
}
