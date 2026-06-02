import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/ChatPanel";
import type { ChatMessage } from "@/hooks/useChatTranscript";

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView; the auto-scroll effect calls it.
  Element.prototype.scrollIntoView = vi.fn();
});

const messages: ChatMessage[] = [
  { id: "1", role: "player", label: "You", text: "a red car" },
  { id: "2", role: "event", label: "Planning", text: "Structured the request." },
  { id: "3", role: "event", label: "Needs attention", text: "Gemini failed.", status: "error" },
];

describe("ChatPanel", () => {
  it("renders each message with its role class and error status", () => {
    render(<ChatPanel messages={messages} lastMessage="seed" />);

    const player = screen.getByText("a red car").closest(".chat-message");
    expect(player).toHaveClass("chat-message--player");

    const failed = screen.getByText("Gemini failed.").closest(".chat-message");
    expect(failed).toHaveClass("chat-message--event");
    expect(failed).toHaveAttribute("data-status", "error");
  });

  it("seeds a single system line from lastMessage when the transcript is empty", () => {
    render(<ChatPanel messages={[]} lastMessage="Type a prompt to begin." />);

    const log = screen.getByRole("log");
    const seed = within(log).getByText("Type a prompt to begin.").closest(".chat-message");
    expect(seed).toHaveClass("chat-message--system");
  });

  it("collapses and expands the log via the header toggle", async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={messages} lastMessage="seed" />);

    expect(screen.getByRole("log")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /chat/i }));
    expect(screen.queryByRole("log")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /chat/i }));
    expect(screen.getByRole("log")).toBeInTheDocument();
  });
});
