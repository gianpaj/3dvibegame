# Plan: chat moderation + profanity filter

Builds on the multiplayer chat (`docs/plans/multiplayer-chat.md`). Adds (a) moderator
deletion of chat messages and (b) a server-side profanity block.

## Decisions (resolved)
- **Moderator designation:** both mechanisms.
  - *Bootstrap allowlist* — `bootstrapModeratorIdentities: string[]` in `world-backend`,
    identity hex strings auto-promoted to `"moderator"` on join. Empty by default.
  - *Runtime* — `set_player_role(targetIdentityHex, role)` reducer to promote/demote
    others without a redeploy. Only `player`/`moderator` are grantable.
- **Who can assign roles:** **owner/admin only** — `set_player_role` is gated by a
  separate `ownerAdminIdentities` allowlist (identity-gated, *not* role-gated), so
  moderators can delete messages but **cannot mint more moderators**. The target is passed
  as a plain **hex string** (not `t.identity()`) so it's callable from the CLI, and the
  caller need not have joined the world.
- **Delete semantics:** hard delete (row removed), consistent with `pruneChatHistory`.
- **Profanity:** **block** the send (reducer throws), **server-only**, **English** —
  via `glin-profanity` (`checkProfanity(body, { languages: ['english'], detectLeetspeak: true })`).
  The optional TensorFlow.js ML layer stays **off** (async/heavy; the sync keyword path
  is what sandboxes cleanly inside the SpacetimeDB module).

## Feasibility note (proven)
`glin-profanity` is pure/synchronous, no FS/network, embedded word lists (~12 KB). A spike
confirmed it both **bundles** (`spacetime build`) and **runs** inside the SpacetimeDB TS
module sandbox (the smoke rejects `"4ss"` via leetspeak). So server-side enforcement is real.

## Backend (`packages/world-backend`)
- **Reuse** the existing privilege check `canManageWorldLifecycle(player)` (role ∈
  {host, moderator, platform_admin}) — already gates world snapshot/reset + AI jobs.
- `send_chat_message`: add the profanity guard before insert.
- `delete_chat_message(messageId)`: active player; message must be in their world; allowed
  if author (`sameIdentity`) **or** `canManageWorldLifecycle`; hard `delete`.
- `set_player_role(targetIdentityHex, role)`: **owner/admin only** (gated by
  `isOwnerAdmin(ctx)` against `ownerAdminIdentities`, not by role); `role ∈
  {player, moderator}`; caller need not have joined; target is looked up across
  `player_session` by normalized hex. `normalizeHex` strips a leading `0x` and lowercases
  on both sides, so either hex form works.
- `joinWorld`: assign `"moderator"` when the joining identity is in
  `bootstrapModeratorIdentities` (and keep it on rejoin).
- `glin-profanity` added as a `world-backend` dependency.

## Client (`packages/3dvibegame-web`)
- Regenerate `module_bindings` (`delete_chat_message`, `set_player_role`).
- Bridge: `deleteChatMessage(messageId)` → `reducers.deleteChatMessage({ messageId: BigInt(id) })`.
- App: derive `canModerateChat` from the local player's `role`; `handleDeleteChat`.
- `ChatPanel`: `onDelete` + `canModerate` props; a hover **×** on a message when it's the
  local player's or they can moderate.

## Tests
- `smoke-chat.mjs`: profanity rejection; author self-delete (ok); non-mod delete of a peer
  (rejected); moderator (SQL-promoted) deletes a peer (ok). *(set_player_role runtime is
  awkward to drive through the CLI's Identity arg encoding — covered by typecheck/build +
  the app path.)*
- `ChatPanel.test.tsx`: delete button shows on own message / hidden on others for
  non-moderators / shown on all for moderators; click calls `onDelete`.

## To become owner/admin + moderator
1. `spacetime login show` → copy your identity hex.
2. In `packages/world-backend/src/index.ts` add it to **both** `ownerAdminIdentities`
   (so only you can assign roles) and `bootstrapModeratorIdentities` (so you can delete
   messages too).
3. Republish + redeploy (signature-changing, so regenerate bindings as well — the client
   doesn't call `set_player_role`, so nothing else breaks).

## Running `set_player_role` (owner/admin only)
You must be logged in as an identity listed in `ownerAdminIdentities`; any other caller
gets `only an owner/admin can set player roles`. The caller does **not** need to have
joined the room.

1. Find the target player's hex:
   ```bash
   spacetime sql --server <url> 3dvibegame "SELECT identity, nickname FROM player_session"
   ```
2. Assign the role (`<url>` is e.g. `https://stdb.3dvibegame.com` or your local
   `http://127.0.0.1:3000`):
   ```bash
   # promote
   spacetime call --server <url> 3dvibegame set_player_role <their-hex> moderator
   # demote
   spacetime call --server <url> 3dvibegame set_player_role <their-hex> player
   ```
   Only `player`/`moderator` are accepted (`host`/`platform_admin` → `unsupported role`).
   The hex may include or omit the `0x` prefix.

> The target is a plain hex **string** arg (not `t.identity()`) specifically so it's
> callable from the CLI — passing an Identity-typed arg fails the CLI's arg encoding.

## Out of scope (v1)
Tombstones/"message removed" audit, censor/mask mode, multi-language, ban/mute, edit history.
