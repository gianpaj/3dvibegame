import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests are network- and browser-free. The capture smoke test needs
// Chromium and runs separately: `pnpm test:browser`.
const browser = process.env.VQ_BROWSER_TESTS === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: browser ? ["tests/**/*.browser.test.ts"] : ["tests/**/*.test.ts"],
    exclude: browser ? [] : ["tests/**/*.browser.test.ts"],
    testTimeout: browser ? 120_000 : 5_000,
    env: { VQ_TMP_ROOT: mkdtempSync(path.join(tmpdir(), "vq-test-")) },
  },
});
