import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GenerationCard } from "@/components/GenerationCard";
import type { AiSessionSnapshot } from "@/core/session/createAiSession";
import type { GenerationActionId } from "@/core/session/generationSession";

const allActions: GenerationActionId[] = [
  "nudge_draft",
  "rotate_draft",
  "scale_draft",
  "release_object",
];

function makeSnapshot(
  stage: AiSessionSnapshot["stage"],
  availableActions: GenerationActionId[],
): AiSessionSnapshot {
  return {
    document: { player_sessions_by_id: {} } as AiSessionSnapshot["document"],
    world: {} as AiSessionSnapshot["world"],
    stage,
    lastMessage: "status message",
    object: null,
    availableActions,
  };
}

describe("GenerationCard", () => {
  it("renders nothing when idle", () => {
    const { container } = render(
      <GenerationCard snapshot={makeSnapshot("idle", [])} onDispatch={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the manipulation and release buttons in grace", () => {
    render(<GenerationCard snapshot={makeSnapshot("grace", allActions)} onDispatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scale/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release to world" })).toBeInTheDocument();
  });

  it("labels the release button Done when the object is already released", () => {
    render(<GenerationCard snapshot={makeSnapshot("released", allActions)} onDispatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("dispatches the matching action id when a button is clicked", async () => {
    const onDispatch = vi.fn();
    const user = userEvent.setup();
    render(<GenerationCard snapshot={makeSnapshot("grace", allActions)} onDispatch={onDispatch} />);

    await user.click(screen.getByRole("button", { name: "Rotate" }));
    expect(onDispatch).toHaveBeenCalledWith("rotate_draft");
  });
});
