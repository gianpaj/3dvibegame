// Procedural whole-body gait — no rig. The same math drives the local (predicted)
// avatar and remote (interpolated) avatars, so remote players walk rather than
// glide. Phase accumulates with distance, not time, so bobbing stops exactly when
// movement stops (no foot-sliding while idle).

export const GAIT_PHASE_PER_UNIT = 2.4; // radians of phase per world unit walked

export interface GaitState {
  /** Accumulated gait phase (radians); grows only while moving. */
  phase: number;
  /** Squash timer in seconds remaining (set on landing). */
  landTimer: number;
}

export interface GaitOutput {
  /** Vertical bob offset added to the group Y. */
  bobY: number;
  /** Lateral tilt (radians) about the forward axis, pivoted at the base. */
  tilt: number;
  /** Forward lean (radians), proportional to horizontal speed. */
  lean: number;
  /** Y scale factor (landing squash + idle breathe). */
  scaleY: number;
}

export function createGaitState(): GaitState {
  return { phase: 0, landTimer: 0 };
}

const LAND_SQUASH_SECONDS = 0.15;

/**
 * Advance the gait phase by distance travelled this frame. Returns the new phase.
 * `horizontalSpeed` in u/s, `dt` in seconds. When speed is ~0 the phase does not
 * advance, so the derived bob/tilt freeze (anti-foot-sliding).
 */
export function advanceGaitPhase(
  phase: number,
  horizontalSpeed: number,
  dt: number,
): number {
  return phase + horizontalSpeed * dt * GAIT_PHASE_PER_UNIT;
}

/**
 * Compute the visual gait transform for a given phase + speed. `elapsedSeconds`
 * drives the idle breathe sine; `landTimer` (seconds remaining) drives the landing
 * squash from 0.85 → 1 over ~150 ms.
 */
export function evaluateGait(input: {
  phase: number;
  horizontalSpeed: number;
  elapsedSeconds: number;
  landTimer: number;
}): GaitOutput {
  const { phase, horizontalSpeed, elapsedSeconds, landTimer } = input;
  const moving = horizontalSpeed > 1e-3;

  const bobY = moving ? Math.sin(2 * phase) * 0.05 : 0;
  const tilt = moving ? Math.sin(phase) * ((4 * Math.PI) / 180) : 0;
  const lean = Math.min(horizontalSpeed / 4, 1) * ((8 * Math.PI) / 180);

  // Idle breathe: slow tiny Y-scale sine when standing still.
  const breathe = moving ? 0 : Math.sin(elapsedSeconds * 1.6) * 0.015;
  // Landing squash: 0.85 at impact, easing back to 1 over LAND_SQUASH_SECONDS.
  const squashProgress =
    landTimer > 0 ? 1 - landTimer / LAND_SQUASH_SECONDS : 1;
  const squash = landTimer > 0 ? 0.85 + 0.15 * clamp01(squashProgress) : 1;
  const scaleY = squash + breathe;

  return { bobY, tilt, lean, scaleY };
}

export function triggerLandingSquash(): number {
  return LAND_SQUASH_SECONDS;
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
