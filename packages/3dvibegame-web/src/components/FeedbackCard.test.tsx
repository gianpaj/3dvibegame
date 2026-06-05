import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeedbackCard } from "@/components/FeedbackCard";
import type { PendingObjectFeedback } from "@/backend/createBackendLifecycleCommands";

function makeOperation(overrides: Partial<PendingObjectFeedback> = {}): PendingObjectFeedback {
  return {
    operationId: "op-create-1",
    objectId: "obj-1",
    objectVersion: 1,
    operation: "create",
    sourcePrompt: "a small pine tree",
    sourceSpecJson: "{}",
    builderSpecJson: "{}",
    modelId: "gemini-2.5-flash",
    promptVersion: "v1",
    ...overrides,
  };
}

describe("FeedbackCard", () => {
  it("renders nothing when there is no operation to rate", () => {
    const { container } = render(<FeedbackCard operation={null} onRate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the rating buttons for an unrated operation", () => {
    render(<FeedbackCard operation={makeOperation()} onRate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Good result" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bad result" })).toBeInTheDocument();
  });

  it("calls onRate with the operation id and rating when 👍 is clicked", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    render(<FeedbackCard operation={makeOperation()} onRate={onRate} />);

    await user.click(screen.getByRole("button", { name: "Good result" }));
    expect(onRate).toHaveBeenCalledWith({ operationId: "op-create-1", rating: "up" });
  });

  it("calls onRate with down when 👎 is clicked", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    render(<FeedbackCard operation={makeOperation()} onRate={onRate} />);

    await user.click(screen.getByRole("button", { name: "Bad result" }));
    expect(onRate).toHaveBeenCalledWith({ operationId: "op-create-1", rating: "down" });
  });

  it("hides the card once an operation has been rated and never reappears for it", async () => {
    const onRate = vi.fn();
    const user = userEvent.setup();
    const operation = makeOperation();
    const { rerender, container } = render(
      <FeedbackCard operation={operation} onRate={onRate} />,
    );

    await user.click(screen.getByRole("button", { name: "Good result" }));
    expect(container).toBeEmptyDOMElement();

    // Re-rendering with the same operation must not bring the card back (no resubmit).
    rerender(<FeedbackCard operation={operation} onRate={onRate} />);
    expect(container).toBeEmptyDOMElement();
    expect(onRate).toHaveBeenCalledTimes(1);
  });

  it("shows the card again for a different operation", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FeedbackCard operation={makeOperation()} onRate={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Good result" }));
    rerender(
      <FeedbackCard operation={makeOperation({ operationId: "op-edit-9" })} onRate={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Good result" })).toBeInTheDocument();
  });

  it("is hidden in viewer mode", () => {
    const { container } = render(
      <FeedbackCard operation={makeOperation()} onRate={vi.fn()} viewerMode />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden while offline", () => {
    const { container } = render(
      <FeedbackCard operation={makeOperation()} onRate={vi.fn()} offline />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
