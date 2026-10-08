import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { build } from "vite";

import { hashJson, sha256 } from "../canonical.ts";
import { repoRoot, tmpRoot } from "../paths.ts";

export const captureAppDir = path.join(tmpRoot, "capture-app");
const captureConfig = path.join(repoRoot, "packages", "3dvibegame-web", "visual-quality", "vite.config.ts");

// Builds the capture page from the current working tree and returns a content
// hash of the output. The hash is the renderer revision: any change to the mesh
// factory, three.js or capture code changes it and invalidates cached captures.
export async function buildCaptureApp(): Promise<{ dir: string; sha256: string }> {
  await build({ configFile: captureConfig, logLevel: "error", build: { outDir: captureAppDir } });
  return { dir: captureAppDir, sha256: hashDirectory(captureAppDir) };
}

function hashDirectory(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
  return hashJson(files.map((file) => [file, sha256(readFileSync(path.join(dir, file)))]));
}
