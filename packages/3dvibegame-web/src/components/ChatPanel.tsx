import { useEffect, useRef, useState } from "react";

import type { BackendChatMessage } from "../backend/createBackendPresenceBridge";
import type { ChatMessage } from "../hooks/useChatTranscript";

interface Props {
  messages: BackendChatMessage[];
  onSend?: (text: string) => void;
  /** Delete a message by id (own message, or any message when a moderator). */
  onDelete?: (messageId: string) => void;
  /** Whether the local player can delete other players' messages. */
  canModerate?: boolean;
  /** Disable the composer (e.g. offline / not in a live room). */
  disabled?: boolean;
  /**
   * Local AI generation transcript, rendered as muted system lines for debugging.
   * Only passed when the in-memory DEBUG flag is on; omitted otherwise.
   */
  debugMessages?: ChatMessage[];
}

function formatTimestamp(value?: string) {
  if (!value) return "";
  const millis = Number(value);
  const date = Number.isFinite(millis) ? new Date(millis) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  messages,
  onSend,
  onDelete,
  canModerate = false,
  disabled = false,
  debugMessages,
}: Props) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message whenever the transcript grows (while open).
  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, debugMessages?.length, open]);

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed || disabled || !onSend) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  const hasContent = messages.length > 0 || (debugMessages?.length ?? 0) > 0;

  return (
    <div className="chat-panel" data-open={open}>
      <button
        type="button"
        className="chat-panel-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Chat</span>
        <span className="chat-panel-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <>
          <div className="chat-log" role="log" aria-label="Chat transcript">
            {!hasContent && <p className="chat-empty">No messages yet.</p>}

            {messages.map((message) => {
              const canDelete = onDelete && (message.isLocal || canModerate);
              return (
                <div
                  key={message.id}
                  className={`chat-message chat-message--${message.isLocal ? "player" : "remote"}`}
                >
                  {canDelete && (
                    <button
                      type="button"
                      className="chat-delete"
                      aria-label={`Delete message from ${message.senderNickname}`}
                      title="Delete message"
                      onClick={() => onDelete(message.id)}
                    >
                      ×
                    </button>
                  )}
                  <strong>{message.senderNickname}</strong>
                  <p>{message.body}</p>
                  {message.createdAt && <time>{formatTimestamp(message.createdAt)}</time>}
                </div>
              );
            })}

            {debugMessages?.map((message) => (
              <div
                key={`debug_${message.id}`}
                className="chat-message chat-message--system chat-message--debug"
                data-status={message.status ?? "complete"}
              >
                <strong>{message.label}</strong>
                <p>{message.text}</p>
              </div>
            ))}

            <div ref={bottomRef} />
          </div>

          <div className="chat-composer">
            <input
              className="chat-input"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? "Join a room to chat…" : "Message the room…"}
              disabled={disabled}
              aria-label="Chat message"
            />
            <button
              type="button"
              className="chat-send"
              onClick={submit}
              disabled={disabled || !draft.trim()}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
