import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Builds the development-only capture page into the ignored .tmp tree. This is
// a separate config with its own root, so the production app build
// (../vite.config.ts, entry ../index.html) never includes it.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  logLevel: "warn",
  build: {
    outDir: fileURLToPath(new URL("../../../.tmp/visual-quality/capture-app", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
});
