// In-memory debug flag — NOT persisted to localStorage. Drives debug-only UI such as
// the local AI generation transcript inside the chat panel. Off by default; a developer
// flips it via the `VITE_DEBUG=true` env var at build/dev time.
export const DEBUG = import.meta.env.VITE_DEBUG === "true";
