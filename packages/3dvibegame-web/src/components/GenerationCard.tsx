import { useState } from "react";

import type { AiSessionSnapshot } from "../core/session/createAiSession";
import type { GenerationActionId } from "../core/session/generationSession";
import { ConfirmModal } from "./ConfirmModal";
import { StatusBadge } from "./StatusBadge";

interface Props {
  snapshot: AiSessionSnapshot;
  onDispatch: (actionId: GenerationActionId) => void;
  onDelete: () => void;
}

export function GenerationCard({ snapshot, onDispatch, onDelete }: Props) {
  const { stage, lastMessage, object, availableActions } = snapshot;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isGenerating =
    stage === "queued" || stage === "planning" || stage === "compiled_artifact_ready";

  // Only show while actively generating, on a failure, or when an object is selected.
  if (!isGenerating && stage !== "failed" && object === null) return null;

  const showMove = availableActions.includes("nudge_draft");
  const showRotate = availableActions.includes("rotate_draft");
  const showScaleUp = availableActions.includes("scale_draft");
  const showScaleDown = availableActions.includes("scale_down_draft");
  const showRelease = availableActions.includes("release_object");

  return (
    <div className="generation-card">
      <div className="generation-card-header">
        <StatusBadge stage={stage} />
        {object && (
          <span className="generation-card-category">{object.builder_spec.object_category}</span>
        )}
      </div>
      <p className="generation-card-message">{lastMessage}</p>

      {(showMove || showRotate || showScaleUp || showScaleDown || showRelease) && (
        <div className="action-buttons">
          {showMove && (
            <button className="btn-action" onClick={() => onDispatch("nudge_draft")}>
              Move
            </button>
          )}
          {showRotate && (
            <button className="btn-action" onClick={() => onDispatch("rotate_draft")}>
              Rotate
            </button>
          )}
          {showScaleUp && (
            <button className="btn-action" onClick={() => onDispatch("scale_draft")}>
              Scale ↑
            </button>
          )}
          {showScaleDown && (
            <button className="btn-action" onClick={() => onDispatch("scale_down_draft")}>
              Scale ↓
            </button>
          )}
          {showRelease && (
            <button className="btn-release" onClick={() => onDispatch("release_object")}>
              {stage === "released" ? "Done" : "Release to world"}
            </button>
          )}
        </div>
      )}

      {object && (
        <button className="btn-danger btn-delete" onClick={() => setConfirmingDelete(true)}>
          Delete
        </button>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this object?"
          message="This permanently removes it from the world for everyone."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
