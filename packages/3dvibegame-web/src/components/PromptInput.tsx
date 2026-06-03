import { useRef, useState } from "react";

interface Props {
  onSubmit: (prompt: string) => Promise<void>;
  disabled: boolean;
  /** When an object is selected, the prompt edits it instead of creating. */
  editing?: boolean;
  placeholder?: string;
}

export function PromptInput({
  onSubmit,
  disabled,
  editing = false,
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  }

  const isDisabled = disabled || submitting;

  return (
    <form className="prompt-form" onSubmit={(e) => void handleSubmit(e)}>
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
        disabled={isDisabled}
        rows={1}
      />
      <button
        className="prompt-submit"
        type="submit"
        disabled={isDisabled || !value.trim()}
      >
        {editing ? "Edit" : "Generate"}
      </button>
    </form>
  );
}
