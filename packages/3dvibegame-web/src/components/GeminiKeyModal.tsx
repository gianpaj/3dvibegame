import { useState } from "react";

const STORAGE_KEY = "vibe-world:gemini-api-key";

export function loadStoredGeminiKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveGeminiKey(key: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // sessionStorage unavailable — key stays in-memory only
  }
}

interface Props {
  onSave: (key: string) => void;
  onDismiss?: () => void;
}

export function GeminiKeyModal({ onSave, onDismiss }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Please enter your Gemini API key.");
      return;
    }
    saveGeminiKey(trimmed);
    onSave(trimmed);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2 className="modal-title">Enter your Gemini API key</h2>
        <p className="modal-description">
          This app uses Google Gemini to generate 3D objects. Your key is only
          stored in this browser tab and never sent to our servers.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className="modal-input"
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            placeholder="AIza…"
            autoFocus
          />
          {error && <p className="modal-error">{error}</p>}
          <button className="modal-submit" type="submit">
            Save and continue
          </button>
        </form>
        <p className="modal-hint">
          Get a free key at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com
          </a>
        </p>
        {onDismiss && (
          <button className="modal-dismiss" type="button" onClick={onDismiss}>
            Continue as viewer
          </button>
        )}
      </div>
    </div>
  );
}
