# Helius-Style Wallet Top-Up & Balance Refresh Design

## Goal

Add a Helius-inspired wallet funding workflow to BagsBot so users can:

1. see their trading wallet address clearly,
2. open a browser wallet funding link (deep link / URL) tied to that address,
3. top up SOL (and optionally USDC), and
4. refresh wallet balance on demand and automatically.

## What Helius CLI Already Does (Reference Behavior)

From the Helius CLI repository README (`helius-labs/helius-cli`), the current UX pattern is:

- `helius keygen` prints a generated wallet address and explicitly instructs users to fund it.
- `helius signup` checks on-chain balances (SOL + USDC), then proceeds only when balance requirements are met.
- error messaging includes the destination wallet address and required amounts.

BagsBot can reuse the same practical pattern (address-first + funding instructions + balance gating), while adding richer wallet-link UX in the terminal dashboard/headless flows.

Reference: https://github.com/helius-labs/helius-cli

## Current State in BagsBot (Findings)

- Wallet management is centralized in `WalletManager`, which can load a keypair, expose the public key, and fetch SOL balance from RPC. It currently has no concept of top-up links, explorer links, or balance polling helpers beyond one-off reads.
- The bot fetches wallet balance once during startup for UI display. There is no periodic refresh loop and no manual refresh keybinding.
- OpenTUI currently handles buy/skip/navigation/quit keybinds, but no wallet-specific actions.
- Headless CLI supports buy/skip/help/status/quit only.
- Config schema/type has no wallet UX settings (explorer base URL, refresh cadence, preferred top-up provider, etc.).

## Functional Requirements

### Core

1. **Show wallet address** in UI + headless status.
2. **Generate top-up URLs** for common wallet funding paths:
   - Solana transfer URL (`solana:<address>` for wallet apps that support protocol handling).
   - Explorer/account URL (`https://solscan.io/account/<address>` or configured explorer).
   - Optional Helius onboarding URL if user wants to create/fund a Helius keypair flow.
3. **Manual refresh action** to fetch latest SOL balance immediately.
4. **Auto-refresh loop** (configurable interval).
5. **Failure-safe UX**: if refresh fails, keep previous balance visible and show a system message.

### Nice-to-have

6. Optional **USDC balance check** helper for workflows requiring both SOL + USDC (similar to Helius signup prerequisites).
7. Optional copy-friendly display in logs/headless mode.

## Proposed Architecture

### 1) Introduce a wallet funding/link service

Add a new module, e.g. `src/trading/wallet-links.ts`:

- `buildSolanaPayLikeLink(address: string, amountSol?: number): string`
- `buildWalletProtocolLink(address: string): string` (e.g. `solana:<address>`)
- `buildExplorerAccountLink(address: string, baseUrl: string): string`
- `buildHeliusReferenceLink(address: string): string` (optional docs/onboarding link)

Rationale: keep URL construction deterministic and testable.

### 2) Extend wallet runtime capabilities

In `WalletManager`:

- keep existing keypair loading/signing unchanged,
- add convenience method `getPublicKeyBase58()` to avoid repeated conversions,
- optionally add `getBalances(connection)` that returns SOL + token balances (future USDC support).

### 3) Add wallet UX config

Extend config schema/types/defaults with:

- `ui.walletRefreshIntervalMs` (default e.g. 15000)
- `ui.walletExplorerBaseUrl` (default `https://solscan.io/account`)
- `ui.enableWalletTopupLinks` (default `true`)

This keeps behavior explicit and tunable.

### 4) Wire refresh lifecycle in bot orchestrator

In `BagsBot`:

- after wallet load, cache wallet address,
- start an interval timer for balance refresh,
- on successful refresh: update OpenTUI state and optionally print headless status line,
- on failure: log warning + add dashboard system event,
- clear interval during shutdown.

### 5) Add OpenTUI actions

Add keybinds in `OpenTUIApp` and action-bar hints:

- `[R]` refresh wallet balance now
- `[W]` show wallet address + links (in message panel)
- `[O]` open explorer/top-up link via platform opener (optional; fallback is “print link”)

Given this is terminal-first, printing actionable links is reliable even when opening browser is unavailable.

### 6) Add headless actions

Extend `HeadlessCli` commands:

- `R` refresh balance,
- `W` print wallet address + funding links.

### 7) (Optional) Browser-open adapter

Add small utility `src/utils/open-url.ts` that shells out safely:

- macOS: `open`
- Linux: `xdg-open`
- Windows: `start`

If unsupported or fails, emit warning and print URL for manual open.

## Rollout Plan (Phased)

### Phase 1 — Balance refresh foundation

- Add refresh interval config + manual refresh command path.
- Update `BagsBot` lifecycle with periodic balance polling.
- Add tests for timer start/stop and refresh error handling.

### Phase 2 — Wallet link generation

- Implement `wallet-links.ts` + unit tests.
- Add wallet/address presentation in UI and headless mode.
- Add action-bar hints and keyboard handling.

### Phase 3 — Open-in-browser + UX polish

- Add optional URL opener wrapper + graceful fallback.
- Add system messages guiding user on minimum funding targets (e.g. tx-fee SOL reserve), inspired by Helius CLI messaging style.

### Phase 4 — Optional USDC readiness checks

- Add token account lookup + formatted balance checks.
- Gate workflows that need USDC with clear “Have vs Need” messages.

## Testing Strategy

1. **Unit tests**
   - link generation edge cases,
   - refresh interval configuration bounds,
   - wallet command handlers in UI/headless.
2. **Bot integration tests**
   - periodic refresh updates dashboard state,
   - refresh failure doesn’t crash bot,
   - shutdown clears timer.
3. **Manual smoke**
   - run headless mode, press `W` and `R`, verify displayed address/links and updated balance.

## Risks & Mitigations

- **Terminal cannot open browser**: always print links as fallback.
- **RPC flakiness**: keep last known balance and show refresh error event.
- **Security concerns**: never expose private key material; only public address and read-only links.

## Suggested Initial MVP Scope

If you want a minimal first merge:

1. periodic + manual balance refresh,
2. wallet address display,
3. printed explorer/top-up links (no auto browser-open yet),
4. tests for link builders + refresh loop.

That gets “top-up directly + refresh balance” functionality with low risk and no platform-specific browser dependencies.
