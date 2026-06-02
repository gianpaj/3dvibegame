import type { BackendPresenceStatus } from "../backend/createBackendPresenceBridge";

interface Props {
  status: BackendPresenceStatus;
  message: string;
}

const STATUS_LABELS: Record<BackendPresenceStatus, string> = {
  disabled: "Local",
  connecting: "Connecting…",
  connected: "Live",
  disconnected: "Offline",
  error: "Error",
};

const STATUS_CLASS: Record<BackendPresenceStatus, string> = {
  disabled: "conn-local",
  connecting: "conn-busy",
  connected: "conn-live",
  disconnected: "conn-offline",
  error: "conn-error",
};

export function ConnectionStatus({ status, message }: Props) {
  return (
    <div className={`conn-badge ${STATUS_CLASS[status]}`} title={message}>
      <span className="conn-dot" />
      {STATUS_LABELS[status]}
    </div>
  );
}
