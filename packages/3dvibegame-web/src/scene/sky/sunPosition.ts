// Pure celestial math for the day/night cycle: maps UTC time-of-day onto a
// stylized circular sun orbit (sunrise 06:00 UTC in the east, noon overhead,
// sunset 18:00 in the west) with the moon parked opposite the sun. Not a real
// ephemeris — see docs/plans/2026-06-12-claudecraft-movement-lighting-learnings.md.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SkyState {
  /** Unit vector from the world toward the sun. */
  sunDirection: Vec3;
  /** Unit vector from the world toward the moon (opposite the sun). */
  moonDirection: Vec3;
  /** Sun height proxy in [-1, 1]: 1 at noon, 0 at sunrise/sunset, <0 at night. */
  sunElevation: number;
  /** Moon height proxy in [-1, 1]: 1 at midnight. */
  moonElevation: number;
}

// Constant southward (+z) lean of the orbit plane so the noon sun never sits
// exactly at the zenith — overhead shadows degenerate to dots otherwise.
const ORBIT_TILT = 0.35;

function normalize(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

/** Sky state for a fractional UTC hour-of-day (e.g. 18.5 = 18:30). */
export function skyStateAtHours(hours: number): SkyState {
  const angle = ((hours - 6) / 24) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    sunDirection: normalize(cos, sin, ORBIT_TILT),
    moonDirection: normalize(-cos, -sin, ORBIT_TILT),
    sunElevation: sin,
    moonElevation: -sin,
  };
}

export function skyStateAtUtc(date: Date): SkyState {
  return skyStateAtHours(
    date.getUTCHours() +
      date.getUTCMinutes() / 60 +
      date.getUTCSeconds() / 3600,
  );
}

/**
 * Dev override: `?timeOfDay=18.5` pins the cycle to a fixed UTC hour so every
 * phase is testable without waiting for the planet. Returns null when absent
 * or unparseable.
 */
export function parseTimeOfDayOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get("timeOfDay");
  if (raw === null || raw.trim() === "") return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours)) return null;
  return ((hours % 24) + 24) % 24;
}

/** Hermite smoothstep of x across [edge0, edge1], clamped to [0, 1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
