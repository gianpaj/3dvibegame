import type { GenerationStage } from "@3dvibegame/scene-authority-ts";

interface Props {
  stage: GenerationStage;
}

const STAGE_LABELS: Partial<Record<string, string>> = {
  idle: "Ready",
  queued: "Queued",
  planning: "Planning",
  voxel_source_ready: "Building",
  compiled_artifact_ready: "Compiling",
  grace: "Review",
  edit_locked: "Editing",
  released: "Released",
  cooldown: "Cooldown",
  failed: "Failed",
};

const STAGE_CLASS: Partial<Record<string, string>> = {
  idle: "badge-idle",
  queued: "badge-busy",
  planning: "badge-busy",
  voxel_source_ready: "badge-busy",
  compiled_artifact_ready: "badge-busy",
  grace: "badge-grace",
  edit_locked: "badge-grace",
  released: "badge-ready",
  cooldown: "badge-cooldown",
  failed: "badge-error",
};

export function StatusBadge({ stage }: Props) {
  return (
    <span className={`status-badge ${STAGE_CLASS[stage] ?? "badge-idle"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
