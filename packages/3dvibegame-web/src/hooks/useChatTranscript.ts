import { useCallback, useEffect, useRef, useState } from "react";

import type { GenerationStage, GenerationStageEvent } from "@3dvibegame/scene-authority-ts";

export type ChatMessageRole = "player" | "system" | "event";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  label: string;
  text: string;
  status?: "pending" | "complete" | "error";
  timestamp?: string;
}

/** Human-friendly labels for each generation stage, shown as the event author. */
export const STAGE_LABELS: Record<GenerationStage, string> = {
  idle: "Ready",
  queued: "Queued",
  planning: "Planning",
  voxel_source_ready: "Voxel source",
  compiled_artifact_ready: "Compiled",
  grace: "Draft ready",
  edit_locked: "Edit lock",
  cooldown: "Cooldown",
  released: "Synced",
  failed: "Needs attention",
};

const MAX_MESSAGES = 32;

interface TranscriptSource {
  stageEvents: GenerationStageEvent[];
}

/**
 * Accumulates a rolling chat transcript (capped at {@link MAX_MESSAGES}) from two inputs:
 * the player's submitted prompts (pushed imperatively via `appendPlayerMessage`) and the
 * session's `stageEvents`, folded in as `event` messages deduped by event id. Mirrors the
 * `syncChatTranscript` behaviour from the old scene-runtime-demo HUD.
 */
export function useChatTranscript(snapshot: TranscriptSource) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seenEventIds = useRef<Set<string>>(new Set());
  const sequence = useRef(0);

  const append = useCallback((message: Omit<ChatMessage, "id"> & { id?: string }) => {
    setMessages((current) => {
      sequence.current += 1;
      const next: ChatMessage = { ...message, id: message.id ?? `chat_${sequence.current}` };
      return [...current, next].slice(-MAX_MESSAGES);
    });
  }, []);

  const appendPlayerMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      append({
        role: "player",
        label: "You",
        text: trimmed,
        timestamp: new Date().toISOString(),
      });
    },
    [append],
  );

  // Fold newly-seen stage events into the transcript.
  useEffect(() => {
    for (const event of snapshot.stageEvents) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);
      append({
        id: `event_${event.id}`,
        role: "event",
        label: STAGE_LABELS[event.stage],
        text: event.message,
        status: event.status,
        timestamp: event.timestamp,
      });
    }
  }, [snapshot.stageEvents, append]);

  return { messages, appendPlayerMessage };
}
