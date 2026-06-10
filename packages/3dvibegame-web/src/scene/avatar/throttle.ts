// Outbound move_player gate: send at most every 100 ms AND only when the avatar
// moved > 1 cm or rotated > 2°. Idle players send nothing. Pure + stateful via a
// small closure so it is trivial to unit test the gate independently of the canvas.

export const MIN_SEND_INTERVAL_MS = 100;
export const MIN_MOVE_DISTANCE = 0.01; // 1 cm
export const MIN_ROTATE_RADIANS = (2 * Math.PI) / 180; // 2 degrees

export interface MoveSample {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYaw: number;
}

export interface MoveGate {
  /**
   * Returns true when `sample` should be sent given the time and the last sent
   * sample. Records the sample as sent when it returns true.
   */
  shouldSend(sample: MoveSample, nowMs: number): boolean;
}

function yawDelta(a: number, b: number): number {
  // Shortest-arc difference so wrapping past ±π doesn't trigger a false send.
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function createMoveGate(): MoveGate {
  let lastSent: MoveSample | null = null;
  let lastSentAt = -Infinity;

  return {
    shouldSend(sample, nowMs) {
      if (nowMs - lastSentAt < MIN_SEND_INTERVAL_MS) return false;

      if (lastSent) {
        const dx = sample.positionX - lastSent.positionX;
        const dy = sample.positionY - lastSent.positionY;
        const dz = sample.positionZ - lastSent.positionZ;
        const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rotated = yawDelta(sample.rotationYaw, lastSent.rotationYaw);
        if (moved < MIN_MOVE_DISTANCE && rotated < MIN_ROTATE_RADIANS) {
          return false;
        }
      }

      lastSent = { ...sample };
      lastSentAt = nowMs;
      return true;
    },
  };
}
