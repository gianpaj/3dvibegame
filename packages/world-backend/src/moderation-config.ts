// Trust-root configuration for chat moderation.
//
// IMPORTANT: a SpacetimeDB module runs in a WASM sandbox with no runtime `process.env`,
// so these are resolved at *build/publish* time. The supported way to configure a
// deployment without editing source is to set the env vars below before `spacetime build`
// / publish; `spacetime build`'s bundler inlines `process.env.*` references. When the env
// var is absent the list is empty, so a fresh clone ships with NO privileged identities.
//
// To add your own owner/admin (who may call `set_player_role`) and/or bootstrap
// moderators (auto-promoted on join), either:
//   - export WORLD_OWNER_ADMIN_IDENTITIES / WORLD_BOOTSTRAP_MODERATOR_IDENTITIES
//     (comma-separated identity hex strings) before building, or
//   - hardcode them in the fallback arrays below (and DO NOT commit personal identities
//     to a shared branch).
//
// `parseIdentityList` is sandbox-safe: it never dereferences `process` directly, so the
// module loads even when no bundler inlining occurred (the list is simply empty).

function envIdentityList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// Read process.env via globalThis so this compiles without @types/node and never throws
// in the sandbox (where `process` is undefined and the value is simply absent).
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;

// Owner/admin identity hex strings. ONLY these may call set_player_role (assign/revoke
// roles). This is the root of trust for who can mint moderators — keep it short.
export const ownerAdminIdentities: string[] = envIdentityList(
  env?.WORLD_OWNER_ADMIN_IDENTITIES,
);

// Identity hex strings auto-promoted to the "moderator" role on join — the bootstrap set
// of moderators. Moderators can delete any chat message, but cannot assign roles.
export const bootstrapModeratorIdentities: string[] = envIdentityList(
  env?.WORLD_BOOTSTRAP_MODERATOR_IDENTITIES,
);
