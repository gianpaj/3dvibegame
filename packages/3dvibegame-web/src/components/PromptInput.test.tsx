import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptInput } from "@/components/PromptInput";

const placeholder = "Describe an object to generate…";

describe("PromptInput", () => {
  it("disables the submit button while the input is empty", () => {
    render(<PromptInput onSubmit={vi.fn().mockResolvedValue(undefined)} disabled={false} />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("disables the textarea when disabled", () => {
    render(<PromptInput onSubmit={vi.fn().mockResolvedValue(undefined)} disabled />);
    expect(screen.getByPlaceholderText(placeholder)).toBeDisabled();
  });

  it("switches to edit placeholder + label when editing", () => {
    render(<PromptInput onSubmit={vi.fn().mockResolvedValue(undefined)} disabled={false} editing />);
    expect(
      screen.getByPlaceholderText("Describe a change to the selected object…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("submits trimmed text on Enter and clears the field", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PromptInput onSubmit={onSubmit} disabled={false} />);

    const textarea = screen.getByPlaceholderText(placeholder);
    await user.type(textarea, "  a palm tree  ");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("a palm tree");
    expect(textarea).toHaveValue("");
  });

  it("shows the avatar badge, placeholder, and Set avatar label in avatar mode", () => {
    render(
      <PromptInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        disabled={false}
        avatarMode
        onExitAvatarMode={vi.fn()}
      />,
    );
    expect(screen.getByText("Avatar mode")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Describe your avatar, e.g. a red robot with a crown…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set avatar" })).toBeInTheDocument();
  });

  it("submits the avatar prompt to onSubmit while in avatar mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <PromptInput
        onSubmit={onSubmit}
        disabled={false}
        avatarMode
        onExitAvatarMode={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Describe your avatar, e.g. a red robot with a crown…",
    );
    await user.type(textarea, "a red robot with a crown");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("a red robot with a crown");
  });

  it("exits avatar mode on Escape", async () => {
    const onExitAvatarMode = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        disabled={false}
        avatarMode
        onExitAvatarMode={onExitAvatarMode}
      />,
    );
    await user.click(
      screen.getByPlaceholderText("Describe your avatar, e.g. a red robot with a crown…"),
    );
    await user.keyboard("{Escape}");
    expect(onExitAvatarMode).toHaveBeenCalled();
  });

  it("exits avatar mode when the badge close button is clicked", async () => {
    const onExitAvatarMode = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        disabled={false}
        avatarMode
        onExitAvatarMode={onExitAvatarMode}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Exit avatar mode" }));
    expect(onExitAvatarMode).toHaveBeenCalled();
  });
});
