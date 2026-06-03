# Plan: real multiplayer text chat (player ↔ player)

## Context

Today there is **no** player-to-player chat. `world-backend` (a TypeScript SpacetimeDB
module) has tables for world / players / objects / locks / AI jobs / snapshots, but no
message table or chat reducer. Players share the *world* and can see each other's presence
and objects, but cannot send text. The `ChatPanel` added recently is display-only: it
echoes the local player's AI prompts + folds in local AI `stageEvents`; none of that is
shared.

This plan adds a shared chat channel: a `chat_message` table, a `send_chat_message`
reducer, client subscription + bindings, and an interactive `ChatPanel` (input + send)
that renders the shared stream with each sender's nickname.

The shared room is a single private world (`defaultWorldVisibility = "private"`), so chat
is scoped to that one world like every other table today.

## Backend (`packages/world-backend`)

### 1. New table — `schema.ts`
```ts
export const ChatMessage = table(
  { name: "chat_message", public: true,
    indexes: [{ name: "chat_message_world_id", accessor: "byWorldId",
                algorithm: "btree", columns: ["worldId"] }] },
  {
    messageId: t.u64().primaryKey().autoInc(),
    worldId: t.u64(),
    senderIdentity: t.identity(),
    senderNickname: t.string(),   // denormalized so messages survive after the sender leaves
    body: t.string(),
    createdAt: t.timestamp(),
  },
);
```
Add `chatMessage: ChatMessage` to the `schema({ … })` object.

### 2. Reducer — `index.ts`
```ts
export const send_chat_message = spacetimedb.reducer(
  { body: t.string() },
  (ctx, { body }) => {
    const player = ctx.db.playerSession.identity.find(ctx.sender);
    if (!player) throw new SenderError("player has not joined a world");
    if (player.presenceState !== "active") throw new SenderError("player is not active in a world");

    const trimmed = body.trim();
    if (!trimmed) throw new SenderError("chat message is empty");
    if (trimmed.length > maxChatBodyLength) throw new SenderError("chat message is too long");

    ctx.db.chatMessage.insert({
      messageId: 0n,                 // autoInc
      worldId: player.worldId,
      senderIdentity: ctx.sender,
      senderNickname: player.nickname,
      body: trimmed,
      createdAt: ctx.timestamp,
    });

    pruneChatHistory(ctx, player.worldId);   // keep newest N per world
  },
);
```
- New const `maxChatBodyLength = 280`.
- `pruneChatHistory(ctx, worldId)`: read `byWorldId`, if count > `maxChatHistoryPerWorld` (e.g. 200),
  delete the oldest (lowest `messageId`) rows. Bounds unbounded table growth — SpacetimeDB
  tables persist, and chat is the only high-frequency append table.
- (No edit/delete reducers in v1.)

### 3. Smoke test — `scripts/smoke-chat.mjs` (+ `smoke:chat` script in `package.json`)
Using the existing `spacetime-smoke-harness.mjs` (same pattern as `smoke-lock-contention.mjs`):
- Alice + Bob `join_world`, `activatePlayers()`.
- `callAs(alice, "send_chat_message", ["hello bob"])`.
- `query("SELECT * FROM chat_message")` → assert one row, `sender_nickname = 'Alice'`, body matches.
- `expectReducerFailure` for: empty body, over-length body, and a non-joined identity.
- Optional: insert > 200 to assert pruning keeps the cap.

## Client bindings
Regenerate `packages/3dvibegame-web/src/backend/module_bindings/` via the project's
`spacetime generate` step (adds `chat_message_table.ts` + `send_chat_message_reducer.ts` +
`types`). This is the same generated-bindings flow the existing reducers use.

## Web app (`packages/3dvibegame-web`)

### 4. Presence bridge — `createBackendPresenceBridge.ts`
- Add `"SELECT * FROM chat_message"` to the `.subscribe([...])` list.
- `installTableListeners`: add `connection.db.chatMessage.onInsert(onChange)` so a new
  message rebuilds the snapshot.
- New snapshot field `chatMessages: BackendChatMessage[]` (sorted by `createdAt`/`messageId`),
  each `{ id, senderIdentity, senderNickname, body, createdAt, isLocal }` (compare
  `senderIdentity` to the connection identity for `isLocal`). Add the type + a `mapChatMessage`
  in `mapBackendAuthorityWorld.ts` / `types.ts`; include `chatMessages: []` in the disabled snapshot.
- New method `sendChat(body: string): Promise<void>` → `connection.reducers.sendChatMessage({ body })`
  (wrapped like `movePlayer`).

### 5. ChatPanel — `components/ChatPanel.tsx`
Becomes interactive and sources the **shared** stream:
- Props: `{ messages: BackendChatMessage[]; onSend?: (text: string) => void; disabled?: boolean }`.
- Render each message with `senderNickname` (label) + `body`, `chat-message--player` for local
  vs a remote variant; keep collapse + auto-scroll.
- Footer input (small textarea/input + Send) calling `onSend`. When `disabled` (not in a live
  room) show a hint "Join a room to chat" and disable the input.

> Design decision: the panel now shows **player chat only** (real, shared). The AI generation
> status stays in `GenerationCard` (where `lastMessage`/stage already render), so we **retire
> the local `useChatTranscript` AI-echo** to avoid mixing a personal AI log with a shared
> channel. (Alternative: keep AI events as local muted `system` lines interleaved — more code,
> muddier UX. Recommend retiring.)

### 6. App wiring — `App.tsx`
- Drop `useChatTranscript` + `appendPlayerMessage`.
- `<ChatPanel messages={backendSnap.chatMessages} onSend={(t) => bridgeRef.current?.sendChat(t)}
   disabled={!isLive} />` in `.hud-top-left`.

### 7. Styles — `styles.css`
Add the chat input/footer + a remote-message accent next to the existing `.chat-*` rules.

### 8. Tests (web, vitest/RTL)
- `ChatPanel.test.tsx` — rewrite for the new props: renders sender nicknames; local vs remote
  class; typing + Send calls `onSend` and clears; disabled state hides the input/shows the hint.
- Remove `useChatTranscript.test.ts` (hook retired) — or repurpose if we keep AI echo.
- Optional bridge unit: `mapChatMessage` sets `isLocal` correctly.

## Files touched
| File | Change |
|---|---|
| `packages/world-backend/src/schema.ts` | new `ChatMessage` table |
| `packages/world-backend/src/index.ts` | `send_chat_message` reducer + `pruneChatHistory` + limits |
| `packages/world-backend/scripts/smoke-chat.mjs` | *(new)* smoke |
| `packages/world-backend/package.json` | `smoke:chat` script |
| `packages/3dvibegame-web/src/backend/module_bindings/**` | *(regen)* chat table + reducer |
| `packages/3dvibegame-web/src/backend/createBackendPresenceBridge.ts` | subscribe + listener + `chatMessages` + `sendChat` |
| `packages/3dvibegame-web/src/backend/mapBackendAuthorityWorld.ts` / `types.ts` | `BackendChatMessage` + map |
| `packages/3dvibegame-web/src/components/ChatPanel.tsx` | interactive shared chat |
| `packages/3dvibegame-web/src/App.tsx` | wire `sendChat` + shared messages |
| `packages/3dvibegame-web/src/styles.css` | input/footer + remote accent |
| `packages/3dvibegame-web/src/components/ChatPanel.test.tsx` | rewrite |

## Verification
1. `pnpm --filter @3dvibegame/world-backend build` (spacetime build compiles the new table/reducer).
2. `pnpm --filter @3dvibegame/world-backend smoke:chat` passes (send, validation failures, prune).
3. Regenerate bindings; `pnpm --filter @3dvibegame/3dvibegame-web typecheck && … test && … build`.
4. Manual (two browsers): Alice sends → Bob sees it within the subscription tick, labeled "Alice".

## Out of scope (v1)
Edit/delete messages, per-message reactions, typing indicators, DMs/whispers, profanity
filtering, multi-world routing (single shared world today), unread badges.

## Decisions (resolved)
1. **Keep** the `useChatTranscript` AI-echo code, but only render it when an in-memory
   `DEBUG` flag is true (env-driven via `import.meta.env.VITE_DEBUG`, **not** persisted to
   localStorage). Default off → production never shows it. The shared `ChatPanel` shows
   real player chat; the AI transcript is an optional debug-only section.
2. **History cap = 200 messages/world** (`pruneChatHistory`).
3. **Local/offline mode**: disable the chat input with a "Join a room to chat" hint
   (panel stays visible).
