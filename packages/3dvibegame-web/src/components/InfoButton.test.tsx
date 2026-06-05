import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InfoButton } from "@/components/InfoButton";

describe("InfoButton", () => {
  it("opens the game info modal", async () => {
    const user = userEvent.setup();
    render(<InfoButton />);

    await user.click(screen.getByRole("button", { name: "Open game info" }));

    expect(
      screen.getByRole("heading", { name: "3dvibegame" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cmd/Ctrl + C")).toBeInTheDocument();
    expect(screen.getByText("Delete / Backspace")).toBeInTheDocument();
  });
});
