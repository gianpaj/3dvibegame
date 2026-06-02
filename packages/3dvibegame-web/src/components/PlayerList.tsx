import type { BackendPlayerPresence } from "../backend/createBackendPresenceBridge";

interface Props {
  players: BackendPlayerPresence[];
}

export function PlayerList({ players }: Props) {
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
        </div>
      ))}
    </div>
  );
}
