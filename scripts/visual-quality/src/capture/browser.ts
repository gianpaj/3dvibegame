import { createRequire } from "node:module";

import { chromium, type Browser, type BrowserContext } from "playwright";

import type {
  CapturePageApi,
  PageCaptureRequest,
  PageCaptureResult,
  PageInfo,
} from "../../../../packages/3dvibegame-web/visual-quality/contract.ts";

// Software GL (SwiftShader via ANGLE): captures don't depend on the local GPU,
// and repeated captures on one machine are stable.
const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
export const GL_BACKEND = "angle-swiftshader";

export type CaptureOutcome =
  | {
      ok: true;
      result: Extract<PageCaptureResult, { ok: true }>;
      info: PageInfo;
      browserErrors: string[];
      latencyMs: number;
    }
  | { ok: false; error: string; info: PageInfo | null; browserErrors: string[]; latencyMs: number };

export class CaptureSession {
  private constructor(
    private readonly browser: Browser,
    private readonly url: string,
    readonly browserInfo: { name: string; version: string; playwright: string },
  ) {}

  // VQ_CHROMIUM_PATH points at a specific Chromium build instead of
  // Playwright's bundled headless shell.
  static async open(url: string): Promise<CaptureSession> {
    const browser = await chromium.launch({
      headless: true,
      args: GL_ARGS,
      executablePath: process.env.VQ_CHROMIUM_PATH || undefined,
    });
    return new CaptureSession(browser, url, {
      name: "chromium",
      version: browser.version(),
      playwright: playwrightVersion(),
    });
  }

  async capture(request: PageCaptureRequest, timeoutMs: number): Promise<CaptureOutcome> {
    const started = performance.now();
    const browserErrors: string[] = [];
    let context: BrowserContext | null = null;
    let info: PageInfo | null = null;
    let timer: NodeJS.Timeout | undefined;

    try {
      // Inside the try: a crashed browser fails this sample instead of the run.
      context = await this.browser.newContext({
        viewport: { width: request.settings.width, height: request.settings.height },
        deviceScaleFactor: request.settings.device_pixel_ratio,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => browserErrors.push(`page error: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(`console error: ${message.text()}`);
      });
      page.on("requestfailed", (req) =>
        browserErrors.push(`request failed: ${req.url()} (${req.failure()?.errorText ?? "unknown"})`),
      );
      page.on("crash", () => browserErrors.push("page crashed"));

      const work = (async (): Promise<PageCaptureResult> => {
        await page.goto(this.url, { waitUntil: "load", timeout: timeoutMs });
        // Explicit readiness contract: the page sets ready or init_error.
        await page.waitForFunction(
          () => {
            const vq = (globalThis as { __vq?: CapturePageApi }).__vq;
            return Boolean(vq && (vq.ready || vq.init_error));
          },
          null,
          { timeout: timeoutMs },
        );
        const state = await page.evaluate(() => {
          const vq = (globalThis as { __vq?: CapturePageApi }).__vq!;
          return { ready: vq.ready, init_error: vq.init_error, info: vq.info };
        });
        info = state.info;
        if (!state.ready) return { ok: false, error: state.init_error ?? "capture page not ready" };
        return page.evaluate(
          (req) => (globalThis as { __vq?: CapturePageApi }).__vq!.capture(req),
          request,
        );
      })();
      // Closing the context on timeout rejects `work`; that rejection is expected.
      work.catch(() => {});
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`capture timed out after ${timeoutMs} ms`)), timeoutMs);
      });

      const result = await Promise.race([work, timeout]);
      const latencyMs = Math.round(performance.now() - started);
      if (!result.ok) return { ok: false, error: result.error, info, browserErrors, latencyMs };
      // Any browser error during the capture makes it untrustworthy.
      if (browserErrors.length) {
        return { ok: false, error: "browser reported errors during capture", info, browserErrors, latencyMs };
      }
      if (!info) return { ok: false, error: "capture page did not report renderer info", info, browserErrors, latencyMs };
      return { ok: true, result, info, browserErrors, latencyMs };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message.split("\n")[0]!,
        info,
        browserErrors,
        latencyMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timer);
      await context?.close().catch(() => {});
    }
  }

  async close() {
    await this.browser.close().catch(() => {});
  }
}

function playwrightVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("playwright/package.json") as { version: string }).version;
}
