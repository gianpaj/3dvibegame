import type { ViewStats } from "./contract";

// Pure image statistics over an RGBA buffer (row-major, top-left origin).
// Background is taken from the four corners, which camera padding keeps clear.

const CHANNEL_TOLERANCE = 6;

// 30° hue buckets centred on these names; low-saturation pixels are neutral.
const HUE_BUCKETS = [
  "red", "orange", "yellow", "chartreuse", "green", "spring",
  "cyan", "azure", "blue", "violet", "magenta", "rose",
] as const;

export function computeViewStats(rgba: Uint8ClampedArray, width: number, height: number): ViewStats {
  const background = cornerBackground(rgba, width, height);
  const counts: Record<string, number> = {};
  let foreground = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
      if (
        Math.abs(r - background[0]) <= CHANNEL_TOLERANCE &&
        Math.abs(g - background[1]) <= CHANNEL_TOLERANCE &&
        Math.abs(b - background[2]) <= CHANNEL_TOLERANCE
      ) {
        continue;
      }
      foreground += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const bucket = hueBucket(r, g, b);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }

  const hue_histogram: Record<string, number> = {};
  for (const [bucket, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    hue_histogram[bucket] = round(count / foreground);
  }

  return {
    foreground_fraction: round(foreground / (width * height)),
    foreground_bbox: foreground
      ? { x0: round(x0 / width), y0: round(y0 / height), x1: round((x1 + 1) / width), y1: round((y1 + 1) / height) }
      : null,
    hue_histogram,
  };
}

export function hueBucket(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const value = max / 255;
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.2 || value < 0.12) {
    return value >= 0.7 ? "neutral_light" : value >= 0.3 ? "neutral_mid" : "neutral_dark";
  }
  let hue: number;
  const delta = max - min;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return HUE_BUCKETS[Math.round(hue / 30) % 12]!;
}

function cornerBackground(rgba: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const pick = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
  };
  const corners = [pick(0, 0), pick(width - 1, 0), pick(0, height - 1), pick(width - 1, height - 1)];
  // Per-channel median of the corners tolerates one occluded corner.
  return [0, 1, 2].map((c) => {
    const sorted = corners.map((p) => p[c]!).sort((a, b) => a - b);
    return Math.round((sorted[1]! + sorted[2]!) / 2);
  }) as [number, number, number];
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
