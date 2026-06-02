import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiKeyModal } from "@/components/GeminiKeyModal";

afterEach(() => {
  sessionStorage.clear();
});

describe("GeminiKeyModal", () => {
  it("shows a validation error when submitting an empty key", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<GeminiKeyModal onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(screen.getByText("Please enter your Gemini API key.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with the entered key", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<GeminiKeyModal onSave={onSave} />);

    await user.type(screen.getByPlaceholderText("AIza…"), "test-key-123");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(onSave).toHaveBeenCalledWith("test-key-123");
  });
});
