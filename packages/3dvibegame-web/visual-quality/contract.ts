// Protocol between the capture page and the Node capture runner
// (scripts/visual-quality). Type-only: the runner imports it without loading
// browser code.

export type Vec3 = [number, number, number];

export type ViewId = "front_three_quarter" | "opposite_three_quarter" | "elevated";

export interface RenderSettings {
  width: number;
  height: number;
  device_pixel_ratio: number;
  background: string;
  fov_degrees: number;
  // Multiplier on the tightest camera distance that keeps the bounds in frame.
  framing_padding: number;
  tone_mapping_exposure: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov_degrees: number;
  near: number;
  far: number;
}

export interface ViewStats {
  // Fraction of pixels that differ from the background colour.
  foreground_fraction: number;
  // Normalised [0,1] bounding box of foreground pixels, or null when blank.
  foreground_bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  // Share of foreground pixels per hue bucket, for colour regression checks.
  hue_histogram: Record<string, number>;
}

export interface PageCaptureRequest {
  // A compiled BuilderSpec, passed through as stored.
  builder_spec: unknown;
  settings: RenderSettings;
}

export interface PageCapturedView {
  view_id: ViewId;
  label: string;
  png_base64: string;
  camera: CameraPose;
  stats: ViewStats;
}

export type PageCaptureResult =
  | {
      ok: true;
      bounds: { min: Vec3; max: Vec3; size: Vec3 };
      views: PageCapturedView[];
    }
  | { ok: false; error: string };

export interface PageInfo {
  capture_version: string;
  three_revision: string;
  tone_mapping: string;
  output_color_space: string;
  gl_renderer: string | null;
}

// Exposed as window.__vq once the page module has initialised. `ready` is the
// render-ready signal the runner waits for; `init_error` reports a page that
// can't render at all (e.g. no WebGL).
export interface CapturePageApi {
  ready: boolean;
  init_error: string | null;
  info: PageInfo | null;
  capture(request: PageCaptureRequest): Promise<PageCaptureResult>;
}
