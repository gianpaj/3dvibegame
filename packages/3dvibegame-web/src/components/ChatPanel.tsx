import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../hooks/useChatTranscript";

interface Props {
  messages: ChatMessage[];
  /** Seed text shown as a single system line when the transcript is empty. */
  lastMessage: string;
}

function formatTimestamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({ messages, lastMessage }: Props) {
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const display: ChatMessage[] = messages.length
    ? messages
    : [{ id: "chat_seed", role: "system", label: "Savi", text: lastMessage }];

  // Auto-scroll to the latest message whenever the transcript grows (while open).
  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [display.length, open]);

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
        <div className="chat-log" role="log" aria-label="Chat transcript">
          {display.map((message) => (
            <div
              key={message.id}
              className={`chat-message chat-message--${message.role}`}
              data-status={message.status ?? "complete"}
            >
              <strong>{message.label}</strong>
              <p>{message.text}</p>
              {message.timestamp && <time>{formatTimestamp(message.timestamp)}</time>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
