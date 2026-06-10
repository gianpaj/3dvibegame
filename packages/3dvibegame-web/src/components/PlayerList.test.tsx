import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlayerList } from "@/components/PlayerList";
import type { BackendPlayerPresence } from "@/backend/createBackendPresenceBridge";

function makePlayer(overrides: Partial<BackendPlayerPresence>): BackendPlayerPresence {
  return {
    id: "id",
    nickname: "Player",
    role: "visitor",
    presenceState: "active",
    transform: {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationYaw: 0,
      rotationPitch: 0,
    },
    isLocal: false,
    ...overrides,
  };
}

describe("PlayerList", () => {
  it("renders only active players and labels the local player as You", () => {
    render(
      <PlayerList
        players={[
          makePlayer({ id: "1", nickname: "Alice", presenceState: "active" }),
          makePlayer({ id: "2", nickname: "Bob", presenceState: "idle" }),
          makePlayer({ id: "3", nickname: "Me", presenceState: "active", isLocal: true }),
        ]}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.getByText("Me (you)")).toBeInTheDocument();
  });

  it("renders nothing when there are no active players", () => {
    const { container } = render(
      <PlayerList players={[makePlayer({ presenceState: "idle" })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an Edit avatar button only on the local player's row", () => {
    const onEditAvatar = vi.fn();
    render(
      <PlayerList
        players={[
          makePlayer({ id: "1", nickname: "Alice", isLocal: false }),
          makePlayer({ id: "2", nickname: "Me", isLocal: true }),
        ]}
        onEditAvatar={onEditAvatar}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Edit avatar" });
    expect(buttons).toHaveLength(1);
  });

  it("invokes onEditAvatar when the local Edit avatar button is clicked", async () => {
    const onEditAvatar = vi.fn();
    const user = userEvent.setup();
    render(
      <PlayerList
        players={[makePlayer({ id: "2", nickname: "Me", isLocal: true })]}
        onEditAvatar={onEditAvatar}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit avatar" }));
    expect(onEditAvatar).toHaveBeenCalledTimes(1);
  });

  it("omits the Edit avatar button when no handler is provided", () => {
    render(
      <PlayerList players={[makePlayer({ id: "2", nickname: "Me", isLocal: true })]} />,
    );
    expect(screen.queryByRole("button", { name: "Edit avatar" })).not.toBeInTheDocument();
  });
});
