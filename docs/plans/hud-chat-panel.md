# Plan: bring back the HUD chat panel in `3dvibegame-web`

## Context

`scene-runtime-demo` had a "Savi chat" panel (`editor/ui/createHud.ts`) — a rolling
transcript of the player's prompts plus system/stage messages. The MVP web app
(`3dvibegame-web`) dropped it during the React port. We want it back as a **collapsible
panel anchored top-left** in the HUD overlay.

The demo kept a `ChatTranscriptMessage[]` (capped 32) with roles `player | system | event`,
folded `snapshot.stageEvents` in (deduped by event id) plus a seed from `snapshot.lastMessage`,
and auto-scrolled to the latest. That logic is sound; we port it to idiomatic React.

Both snapshot paths already carry what we need: `GenerationSnapshot` has
`lastMessage` + `stageEvents: GenerationStageEvent[]`, and the backend-merged snapshot
(`createBackendGenerationSnapshot.ts`) also emits `stageEvents`. One gap: `App.tsx`'s
backend-mode `displaySnapshot` reshape (lines ~129–136) drops `stageEvents` — add it back.

## Approach

### 1. `useChatTranscript` hook (`src/hooks/useChatTranscript.ts`)
- State: `ChatMessage[]` (`{ id, role, label, text, status?, timestamp? }`), capped at 32.
- `appendPlayerMessage(text)` — imperative; called when the user submits a prompt (create or edit).
- Sync effect keyed on `snapshot.stageEvents`: fold new events in, deduped by `event.id` via a
  `useRef<Set<string>>`. Role `event`; label from `STAGE_LABELS[event.stage]`; carries `status`.
- Empty state handled by the panel (seed line from `snapshot.lastMessage`), not stored.
- Returns `{ messages, appendPlayerMessage }`.

### 2. `ChatPanel` component (`src/components/ChatPanel.tsx`)
- Presentational; props `{ messages, lastMessage }`.
- Collapsible: local `open` state, header button toggles. Collapsed = header only.
- Auto-scroll to latest via a bottom-anchor `ref` + effect on `messages`.
- Empty transcript → render one seed `system` row from `lastMessage`.
- Markup mirrors the demo: `chat-message chat-message--{role}` + `data-status`.

### 3. `App.tsx` wiring
- Add `stageEvents: merged.stageEvents` to the backend `displaySnapshot` object.
- `const { messages, appendPlayerMessage } = useChatTranscript(displaySnapshot);`
- In `handlePromptSubmit`, `appendPlayerMessage(prompt)` before dispatch (instant echo).
- Render `<ChatPanel messages={messages} lastMessage={displaySnapshot.lastMessage} />`
  inside `.hud-top-left` (below ConnectionStatus / PlayerList).

### 4. CSS (`src/styles.css`)
- Port `.chat-log` / `.chat-message` / role + `[data-status="error"]` from the demo,
  restyled onto the web HUD tokens (`--surface`, `--border`, `--radius`, blur), plus
  a collapse header + max-height/scroll.

### 5. Tests
- `ChatPanel.test.tsx` — renders player/system/event rows + role classes; error status; empty
  seed from `lastMessage`; collapse toggle hides/shows the log.
- `useChatTranscript.test.ts` — `appendPlayerMessage` adds a player row; same `stageEvents`
  re-render doesn't duplicate; 32-cap drops the oldest.

## Files touched

| File | Change |
|---|---|
| `src/hooks/useChatTranscript.ts` | *(new)* transcript accumulator |
| `src/components/ChatPanel.tsx` | *(new)* collapsible chat log |
| `src/components/ChatPanel.test.tsx` | *(new)* |
| `src/hooks/useChatTranscript.test.ts` | *(new)* |
| `src/App.tsx` | passthrough `stageEvents`; wire hook + panel; echo on submit |
| `src/styles.css` | port chat styles into HUD |

## Verification
`pnpm --filter @3dvibegame/3dvibegame-web typecheck && … test && … build`, plus an
`agent-browser` smoke that a submitted prompt echoes instantly and stage events stream below.
