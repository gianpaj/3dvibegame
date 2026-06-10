import type { BackendPlayerPresence } from "../backend/createBackendPresenceBridge";

interface Props {
  players: BackendPlayerPresence[];
  /** Switches the prompt box into avatar mode for the local player. */
  onEditAvatar?: () => void;
}

export function PlayerList({ players, onEditAvatar }: Props) {
  const active = players.filter((p) => p.presenceState === "active");
  if (active.length === 0) return null;

  return (
    <div className="player-list">
      {active.map((player) => (
        <div key={player.id} className={`player-chip ${player.isLocal ? "player-chip-local" : ""}`}>
          <span className="player-dot" />
          <span className="player-name">
            {player.isLocal ? `${player.nickname} (you)` : player.nickname}
          </span>
          {player.isLocal && onEditAvatar && (
            <button
              type="button"
              className="player-edit-avatar"
              onClick={onEditAvatar}
              title="Re-create your avatar from a prompt"
            >
              Edit avatar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
