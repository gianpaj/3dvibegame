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
  "scale_down_draft",
  "release_object",
];

const fakeObject = {
  object_id: "obj_1",
  builder_spec: { object_category: "tree" },
} as unknown as NonNullable<AiSessionSnapshot["object"]>;

function makeSnapshot(
  stage: AiSessionSnapshot["stage"],
  availableActions: GenerationActionId[],
  object: AiSessionSnapshot["object"] = null,
): AiSessionSnapshot {
  return {
    document: { player_sessions_by_id: {} } as AiSessionSnapshot["document"],
    world: {} as AiSessionSnapshot["world"],
    stage,
    lastMessage: "status message",
    stageEvents: [],
    object,
    availableActions,
  };
}

describe("GenerationCard", () => {
  it("renders nothing when idle with no object selected", () => {
    const { container } = render(
      <GenerationCard snapshot={makeSnapshot("idle", [])} onDispatch={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when nothing is generating and no object is selected", () => {
    const { container } = render(
      <GenerationCard
        snapshot={makeSnapshot("released", allActions)}
        onDispatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the manipulation and release buttons in grace", () => {
    render(
      <GenerationCard
        snapshot={makeSnapshot("grace", allActions, fakeObject)}
        onDispatch={vi.fn()}
        onDelete={vi.fn()}
        canDuplicate
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scale ↑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scale ↓" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release to world" })).toBeInTheDocument();
  });

  it("labels the release button Done when the selected object is already released", () => {
    render(
      <GenerationCard
        snapshot={makeSnapshot("released", allActions, fakeObject)}
        onDispatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("shows the AI-edit hint for a selected released object", () => {
    render(
      <GenerationCard
        snapshot={makeSnapshot("released", allActions, fakeObject)}
        onDispatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/edit with AI/i)).toBeInTheDocument();
  });

  it("dispatches the matching action id when a button is clicked", async () => {
    const onDispatch = vi.fn();
    const user = userEvent.setup();
    render(
      <GenerationCard
        snapshot={makeSnapshot("grace", allActions, fakeObject)}
        onDispatch={onDispatch}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rotate" }));
    expect(onDispatch).toHaveBeenCalledWith("rotate_draft");
  });

  it("calls onDuplicate when the duplicate button is clicked", async () => {
    const onDuplicate = vi.fn();
    const user = userEvent.setup();
    render(
      <GenerationCard
        snapshot={makeSnapshot("released", allActions, fakeObject)}
        onDispatch={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={onDuplicate}
        canDuplicate
      />,
    );

    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete only after confirming in the modal", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <GenerationCard
        snapshot={makeSnapshot("released", allActions, fakeObject)}
        onDispatch={vi.fn()}
        onDelete={onDelete}
      />,
    );

    // First Delete opens the confirmation; onDelete not called yet.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this object?")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    // Cancel closes it without deleting.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();

    // Re-open and confirm.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement,
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
