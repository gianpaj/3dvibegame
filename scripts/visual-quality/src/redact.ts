// Removes credentials from text before it is logged or saved. Covers the exact
// key plus OpenAI-style key fragments that APIs echo back in error messages
// (e.g. "Incorrect API key provided: sk-proj-****abcd").
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(/sk-[A-Za-z0-9_*.-]{4,}/g, "sk-[REDACTED]");
}

export function redactValue<T>(value: T, secrets: Array<string | undefined>): T {
  return JSON.parse(redactSecrets(JSON.stringify(value), secrets)) as T;
}
