import { useRef, useState } from "react";

interface Props {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
  /** When an object is selected, the prompt edits it instead of creating. */
  editing?: boolean;
  placeholder?: string;
}

export function PromptInput({ onSubmit, disabled, editing = false, placeholder }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="prompt-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          placeholder ??
          (editing
            ? "Describe a change to the selected object…"
            : "Describe an object to generate…")
        }
        disabled={disabled}
        rows={1}
      />
      <button className="prompt-submit" type="submit" disabled={disabled || !value.trim()}>
        {editing ? "Edit" : "Generate"}
      </button>
    </form>
  );
}
