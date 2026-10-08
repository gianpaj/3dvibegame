import { createHash } from "node:crypto";

// JSON with recursively sorted object keys, so equal values hash equally
// regardless of key order. Used for artifact identity and reuse keys.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256(canonicalJson(value));
}
