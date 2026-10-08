import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

// Write-then-rename so an interrupted run never leaves a truncated record that
// a resumed run would mistake for a finished one.
export function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, file);
}
