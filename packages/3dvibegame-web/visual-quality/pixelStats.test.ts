import { computeViewStats, hueBucket } from "./pixelStats";

function image(width: number, height: number, background: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([...background, 255], i * 4);
  return {
    data,
    fill(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data.set([...rgb, 255], (y * width + x) * 4);
    },
  };
}

describe("computeViewStats", () => {
  it("reports a blank image as zero foreground", () => {
    const img = image(20, 10, [170, 179, 191]);
    expect(computeViewStats(img.data, 20, 10)).toEqual({
      foreground_fraction: 0,
      foreground_bbox: null,
      hue_histogram: {},
    });
  });

  it("measures foreground area, bounds and hue", () => {
    const img = image(20, 10, [170, 179, 191]);
    img.fill(5, 2, 15, 8, [200, 40, 40]);
    const stats = computeViewStats(img.data, 20, 10);
    expect(stats.foreground_fraction).toBe(0.3);
    expect(stats.foreground_bbox).toEqual({ x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.8 });
    expect(stats.hue_histogram).toEqual({ red: 1 });
  });

  it("ignores near-background noise", () => {
    const img = image(10, 10, [170, 179, 191]);
    img.fill(0, 0, 10, 10, [172, 177, 193]);
    expect(computeViewStats(img.data, 10, 10).foreground_fraction).toBe(0);
  });
});

describe("hueBucket", () => {
  it.each([
    [[200, 40, 40], "red"],
    [[230, 200, 40], "yellow"],
    [[30, 160, 60], "green"],
    [[30, 70, 200], "blue"],
    [[230, 130, 30], "orange"],
    [[240, 240, 240], "neutral_light"],
    [[128, 128, 128], "neutral_mid"],
    [[20, 20, 22], "neutral_dark"],
  ] as const)("classifies %j as %s", (rgb, bucket) => {
    expect(hueBucket(rgb[0], rgb[1], rgb[2])).toBe(bucket);
  });
});
