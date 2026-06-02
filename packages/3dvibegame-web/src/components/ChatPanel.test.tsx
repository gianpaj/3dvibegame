import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/ChatPanel";
import type { BackendChatMessage } from "@/backend/createBackendPresenceBridge";
import type { ChatMessage } from "@/hooks/useChatTranscript";

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView; the auto-scroll effect calls it.
  Element.prototype.scrollIntoView = vi.fn();
});

function msg(overrides: Partial<BackendChatMessage>): BackendChatMessage {
  return {
    id: "1",
    senderId: "0xabc",
    senderNickname: "Alice",
    body: "hello",
    createdAt: "",
    isLocal: false,
    ...overrides,
  };
}

const messages: BackendChatMessage[] = [
  msg({ id: "1", senderNickname: "Alice", body: "hi all", isLocal: true }),
  msg({ id: "2", senderNickname: "Bob", body: "hey alice", isLocal: false }),
];

describe("ChatPanel", () => {
  it("renders sender nicknames with local vs remote styling", () => {
    render(<ChatPanel messages={messages} onSend={() => {}} />);

    const local = screen.getByText("hi all").closest(".chat-message");
    expect(local).toHaveClass("chat-message--player");
    expect(screen.getByText("Alice")).toBeInTheDocument();

    const remote = screen.getByText("hey alice").closest(".chat-message");
    expect(remote).toHaveClass("chat-message--remote");
  });

  it("sends a typed message and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    const input = screen.getByLabelText("Chat message");
    await user.type(input, "well hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("well hello");
    expect(input).toHaveValue("");
  });

  it("sends on Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    await user.type(screen.getByLabelText("Chat message"), "ping{Enter}");
    expect(onSend).toHaveBeenCalledWith("ping");
  });

  it("disables the composer and shows a hint when offline", () => {
    render(<ChatPanel messages={[]} onSend={() => {}} disabled />);

    const input = screen.getByLabelText("Chat message");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", expect.stringMatching(/join a room/i));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("renders debug AI transcript lines when provided", () => {
    const debugMessages: ChatMessage[] = [
      { id: "e1", role: "event", label: "Planning", text: "Structured the request." },
    ];
    render(<ChatPanel messages={messages} onSend={() => {}} debugMessages={debugMessages} />);

    const debug = screen.getByText("Structured the request.").closest(".chat-message");
    expect(debug).toHaveClass("chat-message--debug");
  });

  it("collapses and expands via the header toggle", async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={messages} onSend={() => {}} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /chat/i }));
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });
});
