import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// VQ_TMP_ROOT redirects all generated output (tests use a throwaway directory).
export const tmpRoot = process.env.VQ_TMP_ROOT
  ? path.resolve(process.env.VQ_TMP_ROOT)
  : path.join(repoRoot, ".tmp", "visual-quality");
export const runsRoot = path.join(tmpRoot, "runs");
export const cacheRoot = path.join(tmpRoot, "cache");
export const evalsRoot = path.join(repoRoot, "evals", "visual-quality");

// pnpm runs package scripts from the package directory; resolve user-supplied
// paths against the directory the command was typed in.
export function resolveUserPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

export function repoRelative(p: string): string {
  return path.relative(repoRoot, p) || ".";
}
