import { useState } from "react";

const STORAGE_KEY = "vibe-world:player-name";

export function loadStoredPlayerName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePlayerName(name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // localStorage unavailable — name stays in-memory only
  }
}

interface Props {
  onSave: (name: string) => void;
}

export function NameModal({ onSave }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!trimmed) {
      setError("Please enter a name.");
      return;
    }
    savePlayerName(trimmed);
    onSave(trimmed);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2 className="modal-title">What's your name?</h2>
        <p className="modal-description">
          This is how other players will see you in the world.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className="modal-input"
            type="text"
            value={value}
            maxLength={24}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            placeholder="e.g. Skyler"
            autoFocus
          />
          {error && <p className="modal-error">{error}</p>}
          <button className="modal-submit" type="submit">
            Enter the world
          </button>
        </form>
      </div>
    </div>
  );
}
