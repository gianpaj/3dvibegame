import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
