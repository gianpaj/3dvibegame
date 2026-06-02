import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NameModal } from "@/components/NameModal";

afterEach(() => {
  localStorage.clear();
});

describe("NameModal", () => {
  it("shows a validation error when submitting an empty name", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NameModal onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Enter the world" }));

    expect(screen.getByText("Please enter a name.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with the trimmed name and persists it", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NameModal onSave={onSave} />);

    await user.type(screen.getByPlaceholderText("e.g. Skyler"), "  Skyler  ");
    await user.click(screen.getByRole("button", { name: "Enter the world" }));

    expect(onSave).toHaveBeenCalledWith("Skyler");
    expect(localStorage.getItem("vibe-world:player-name")).toBe("Skyler");
  });
});
