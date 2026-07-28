import { useRef, useState } from "react";

interface Props {
  onSubmit: (prompt: string) => Promise<void>;
  disabled: boolean;
  /** When an object is selected, the prompt edits it instead of creating. */
  editing?: boolean;
  /** When true, the prompt re-creates the player's avatar body. */
  avatarMode?: boolean;
  /** Called when the player presses Esc in avatar mode (or clicks the badge ×). */
  onExitAvatarMode?: () => void;
  placeholder?: string;
}

export function PromptInput({
  onSubmit,
  disabled,
  editing = false,
  avatarMode = false,
  onExitAvatarMode,
  placeholder,
}: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setValue("");
    } catch {
      // Text preserved; App.tsx sets contextMsg with the error detail.
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && avatarMode) {
      e.preventDefault();
      onExitAvatarMode?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  }

  const isDisabled = disabled || submitting;
  const defaultPlaceholder = avatarMode
    ? "Describe your avatar, e.g. a red robot with a crown…"
    : editing
      ? "Describe a change to the selected object…"
      : "Describe an object to generate…";

  return (
    <form className="prompt-form" onSubmit={(e) => void handleSubmit(e)}>
      {avatarMode && (
        <span className="prompt-mode-badge prompt-mode-avatar">
          Avatar mode
          <button
            type="button"
            className="prompt-mode-exit"
            onClick={onExitAvatarMode}
            aria-label="Exit avatar mode"
          >
            ×
          </button>
        </span>
      )}
      <textarea
        ref={textareaRef}
        className="prompt-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? defaultPlaceholder}
        disabled={isDisabled}
        rows={1}
      />
      <button
        className="prompt-submit"
        type="submit"
        disabled={isDisabled || !value.trim()}
      >
        {avatarMode ? "Set avatar" : editing ? "Edit" : "Generate"}
      </button>
    </form>
  );
}
