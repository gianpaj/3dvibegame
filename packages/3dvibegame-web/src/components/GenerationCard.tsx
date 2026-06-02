import type { AiSessionSnapshot } from "../core/session/createAiSession";
import type { GenerationActionId } from "../core/session/generationSession";
import { StatusBadge } from "./StatusBadge";

interface Props {
  snapshot: AiSessionSnapshot;
  onDispatch: (actionId: GenerationActionId) => void;
}

export function GenerationCard({ snapshot, onDispatch }: Props) {
  const { stage, lastMessage, object, availableActions } = snapshot;

  console.log("[GenerationCard] stage=%s activeObject=%s availableActions=%o", stage, object?.object_id ?? "null", availableActions);
  const isGenerating =
    stage === "queued" || stage === "planning" || stage === "compiled_artifact_ready";

  // Only show while actively generating, on a failure, or when an object is selected.
  if (!isGenerating && stage !== "failed" && object === null) return null;

  const showMove = availableActions.includes("nudge_draft");
  const showRotate = availableActions.includes("rotate_draft");
  const showScale = availableActions.includes("scale_draft");
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

      {(showMove || showRotate || showScale || showRelease) && (
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
          {showScale && (
            <button className="btn-action" onClick={() => onDispatch("scale_draft")}>
              Scale ↑
            </button>
          )}
          {showRelease && (
            <button className="btn-release" onClick={() => onDispatch("release_object")}>
              {stage === "released" ? "Done" : "Release to world"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
