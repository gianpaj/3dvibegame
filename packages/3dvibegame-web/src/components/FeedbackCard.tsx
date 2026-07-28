import { useState } from "react";

import type { PendingObjectFeedback } from "../backend/createBackendLifecycleCommands";

export type FeedbackRating = "up" | "down";

interface Props {
  /** The create/edit the local player just performed, or null when there's nothing to rate. */
  operation: PendingObjectFeedback | null;
  onRate: (input: { operationId: string; rating: FeedbackRating }) => void;
  /** Viewers can't create/edit, so they're never asked to rate. */
  viewerMode?: boolean;
  /** Hidden while disconnected — the submit reducer needs a live room. */
  offline?: boolean;
}

/**
 * Asks the local player to rate (👍/👎) their most recent AI create/edit. Shows once
 * per operation: rating or dismissing (or any operation already handled) hides the card
 * immediately and keeps it hidden, so a player can't resubmit for the same create/edit.
 */
export function FeedbackCard({ operation, onRate, viewerMode = false, offline = false }: Props) {
  // Operations the player has already rated or dismissed — either way the card stays hidden.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());

  if (!operation || viewerMode || offline) return null;
  if (handled.has(operation.operationId)) return null;

  function dismiss() {
    if (!operation) return;
    setHandled((prev) => new Set(prev).add(operation.operationId));
  }

  function rate(rating: FeedbackRating) {
    if (!operation) return;
    const { operationId } = operation;
    // Hide immediately (don't wait for the round-trip); the reducer reject path is a
    // safety net for double-clicks / reconnects.
    setHandled((prev) => new Set(prev).add(operationId));
    onRate({ operationId, rating });
  }

  return (
    <div className="feedback-card">
      <p className="feedback-card-message">How did that turn out?</p>
      <div className="feedback-card-buttons">
        <button
          className="btn-feedback"
          aria-label="Good result"
          onClick={() => rate("up")}
        >
          👍
        </button>
        <button
          className="btn-feedback"
          aria-label="Bad result"
          onClick={() => rate("down")}
        >
          👎
        </button>
        <button
          className="btn-feedback-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
