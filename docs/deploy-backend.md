# Deploying the backend (SpacetimeDB + AI worker) on Coolify

This guide deploys the multiplayer backend on a public Ubuntu VPS using
[Coolify](https://coolify.io). Two services:

1. **SpacetimeDB** — the authoritative server that runs the `world-backend` module.
2. **AI worker** *(optional)* — runs Gemini server-side so players need no API key.
   Exposes `POST /author` (create/refine with a server key, budget-capped) and
   `POST /compile` (geometry compilation). The player app falls back to
   browser-side Gemini (BYOK) if you skip it.

> **Reachability.** The player app runs in users' browsers (e.g. on Vercel), so the
> SpacetimeDB endpoint must be **publicly reachable over `wss://` with a valid TLS
> cert**. If the server is only reachable inside a VPN, only VPN users can connect.
> Coolify's domain + Let's Encrypt gives you the public TLS endpoint you need.

> **Version match.** The workspace pins `spacetimedb@2.0.3`. The server image, your
> local `spacetime` CLI, and the workspace must all be on compatible versions or
> publish/connect fails with ABI errors.

---

## 0. DNS (Cloudflare)

A Coolify "domain" is just a hostname — it only works once DNS points it at your
VPS. Pick subdomains and add records in Cloudflare DNS for `3dvibegame.com`:

| Type | Name   | Content (VPS public IP) | Proxy status        |
|------|--------|-------------------------|---------------------|
| A    | `stdb` | `<your VPS IPv4>`       | **DNS only** (grey) |
| A    | `ai`   | `<your VPS IPv4>`       | **DNS only** (grey) |

(Use `AAAA` instead if your VPS is IPv6-only.)

**Use "DNS only" (grey cloud), not the orange-cloud proxy.** Coolify/Traefik issues
Let's Encrypt certificates via the ACME HTTP-01 challenge on port 80 and terminates
TLS itself. Cloudflare's proxy intercepts that challenge and double-terminates TLS,
which breaks issuance and complicates the WebSocket upgrade. Grey-cloud points the
hostname straight at the VPS so Coolify can get a cert and WebSockets pass through.

> If you specifically want Cloudflare in front (DDoS/caching), you *can* proxy
> (orange) since Cloudflare supports WebSockets — but set SSL/TLS mode to
> **Full (strict)**, ensure a valid origin cert, and expect extra setup.

On the VPS, open firewall ports **80 and 443** (80 is required for the ACME
challenge). Verify before deploying: `dig +short stdb.3dvibegame.com` returns your
VPS IP.

---

## 1. SpacetimeDB on Coolify

Files: [`deploy/spacetimedb/docker-compose.yml`](../deploy/spacetimedb/docker-compose.yml).

1. In Coolify → **New Resource → Docker Compose**, paste the compose file (or point
   it at this repo path).
2. Set a **domain**, e.g. `stdb.3dvibegame.com`. Coolify provisions TLS and proxies
   `443 → container:3000`, forwarding the WebSocket upgrade automatically (don't put
   another proxy in front that strips `Upgrade` headers).
3. Keep the named volume `stdb-data` — it holds **world data and the server's
   identity (JWT) keys**. Without it, every redeploy wipes the world and resets
   identities.
4. Deploy. Confirm it's up: `curl https://stdb.3dvibegame.com/v1/ping` (or check the
   Coolify logs for the listen address).

The container runs:
`spacetime start --listen-addr 0.0.0.0:3000 --data-dir /data`

### Health check (optional)

"No health check configured" is informational — the server runs fine without one.
To let Coolify confirm health and auto-restart on failure, use SpacetimeDB's ping
endpoint: **`GET /v1/ping` → 200** on port 3000.

- **Coolify UI:** in the resource's **Health Check** settings, set Scheme `http`,
  Host `localhost`, Port `3000`, Path `/v1/ping`, expected status `200`.
- **Compose:** uncomment the `healthcheck` block in
  `deploy/spacetimedb/docker-compose.yml`.

Either way the probe runs *inside* the container, so it needs `curl` or `wget` in the
image — check with `docker exec <container> sh -c 'command -v curl wget'`. If neither
exists, skip the health check (a failing probe would mark the container unhealthy).

---

## 2. Publish the `world-backend` module

From your machine (CLI version must match the server):

```bash
# Register the self-hosted server (accept its fingerprint when prompted)
spacetime server add 3dvibegame --url https://stdb.3dvibegame.com

# Get a token ISSUED BY this server. If you already have a global/maincloud login,
# `spacetime login` prints "You are already logged in" and skips — so log out first,
# otherwise publish fails with `TokenError(InvalidSignature)` / 401 (the server can't
# verify a token signed by a different issuer).
spacetime logout
spacetime login --server-issued-login https://stdb.3dvibegame.com

# Publish the module as `3dvibegame`
cd packages/world-backend
spacetime publish -c --server https://stdb.3dvibegame.com --yes 3dvibegame
```

- `-c` / `--delete-data` wipes existing data. **Use it the first time** so the new
  default room is created as **private + destructive** (an existing public world
  wouldn't pick up the new settings). **Drop `-c`** on later publishes to preserve
  worlds.
- Verify: `spacetime list --server https://stdb.3dvibegame.com` shows `3dvibegame`.

Re-run `spacetime publish` (without `-c`) whenever you change `world-backend`.

---

## 3. AI worker on Coolify *(optional)*

Skip this if you're fine with players supplying their own Gemini key in the browser.
To run Gemini server-side (no player API key needed, spend capped by the server):

File: [`packages/ai-worker/Dockerfile`](../packages/ai-worker/Dockerfile).

In Coolify → **New Resource → Dockerfile** (or a Git-based app with Build Pack =
Dockerfile):

- **Build settings** — both paths are relative to the **repo root**, and they must be
  set together:
  - **Base Directory (build context):** `/` — the repo root, NOT `/packages/ai-worker`.
    It's a pnpm workspace, so the build needs the root `pnpm-lock.yaml` +
    `pnpm-workspace.yaml` + every package's `package.json`.
  - **Dockerfile Location:** `/packages/ai-worker/Dockerfile` (the Dockerfile isn't at
    the root, so this must include the full path).
  - Symptoms of getting these wrong: base dir at the package →
    `[ERR_PNPM_NO_LOCKFILE] ... pnpm-lock.yaml is absent` (+ corepack pulls the wrong
    pnpm version); Dockerfile Location left at the root →
    `failed to read dockerfile: open Dockerfile: no such file or directory`.
- **Port:** `8787`
- **Domain:** e.g. `ai.3dvibegame.com` (TLS via Coolify)
- **Env:**
  - `AI_WORKER_ALLOWED_ORIGIN=https://3dvibegame.com` (CORS; lock it to
    your app's origin, not `*`, in production)
  - `GOOGLE_GENERATIVE_AI_API_KEY` — **required** for the `/author` endpoint (server-side
    create/refine). Without it, `/author` returns 500 and players fall back to browser Gemini.
  - `AI_WORKER_DAILY_BUDGET_USD` — **recommended**. Sets a daily USD spend cap on
    `/author` (e.g. `1.00`). Requests beyond the cap get a 429 until UTC midnight.
  - `AI_WORKER_RATE_LIMIT_PER_MIN` — **recommended**. Per-IP request cap per minute
    (e.g. `10`). Protects against a single player hammering the endpoint.
  - `AI_WORKER_MODEL` — optional; defaults to `gemini-2.5-flash`.

> **Why a Dockerfile (not Coolify's auto-build)?** Coolify's Nixpacks buildpack can
> build a plain Node app without a Dockerfile, but `ai-worker` is a pnpm workspace
> package that imports `@3dvibegame/ai-planning` and `@3dvibegame/scene-authority-ts`
> as source. Nixpacks auto-detection handles that poorly, so the Dockerfile (which
> installs the whole workspace) is the reliable path.

---

## 4. Point the player app at the backend

Set these in the player app's host (e.g. Vercel project env), then redeploy:

```sh
VITE_SPACETIMEDB_URI=https://stdb.3dvibegame.com
VITE_SPACETIMEDB_DATABASE=3dvibegame
# Use http-worker if you deployed the AI worker in step 3 (server-side Gemini key).
# Use browser-gemini to let players supply their own BYOK key instead.
VITE_AI_CLIENT_MODE=http-worker
VITE_AI_WORKER_URL=https://ai.3dvibegame.com
```

The SDK upgrades `https://` → `wss://` for the subscribe socket automatically.

---

## 5. Verify end to end

Open the app → enter a name → the connection pill should read **Live**, and the
`[backend]` console logs should show `subscription applied`.

- **404 on the subscribe socket** → the published module name doesn't match
  `VITE_SPACETIMEDB_DATABASE`. Run `spacetime list`.
- **TLS / `Upgrade` error** → the proxy isn't forwarding WebSockets, or you're
  pointing at `ws://` from an `https://` app (mixed content).
- **Empty world after a redeploy** → the `stdb-data` volume wasn't persisted.
- **Container restart-loops with `Error: Permission denied (os error 13)`** after
  `database running in data directory /data` → the image runs as a non-root user but
  the fresh named volume mounts in root-owned, so it can't write `/data`. The compose
  sets `user: "0:0"` to run as root and fix this. (Alternatively, `chown` the volume
  to the image's runtime UID, but running as root is simplest.)

---

## Securing the server (keep it to just `3dvibegame`)

The public endpoint that lets browsers play also exposes the publish/admin HTTP API,
and a standalone SpacetimeDB server has **no built-in publish allowlist** — anyone who
can reach it can mint an anonymous identity and publish their *own* databases. Two
layers keep the server to just `3dvibegame`:

### 1. Ownership (already in place)

`3dvibegame` is owned by the identity from your server-issued login. Only that identity
can republish or delete it — strangers are rejected. **That ownership lives entirely in
your CLI token** (`~/.config/spacetime/cli.toml`): back it up and keep it private.
Whoever holds it controls the database; if you lose it you can't republish without
server-key surgery.

### 2. Block public publishing (stop new databases)

Gameplay only needs the **WebSocket subscribe** path, which is an HTTP **`GET`** upgrade
(`GET /v1/database/3dvibegame/subscribe`); reducer traffic then flows over that socket.
Publishing and admin use **`POST` / `DELETE`** (`POST /v1/database/<name>`). So restrict
the public route to read methods and publish from a trusted position:

- **At the Coolify/Traefik edge**, add a higher-priority router that matches only the
  write methods and denies them with an IP-allowlist middleware. Coolify's existing
  router keeps serving gameplay (`GET`/WS) untouched. Add these labels to the
  `spacetimedb` service in the compose (Coolify merges them), then redeploy:

  ```yaml
      labels:
        - "traefik.enable=true"
        # Service target (port the container listens on).
        - "traefik.http.services.stdb.loadbalancer.server.port=3000"
        # A router that ONLY matches writes, evaluated before Coolify's router.
        - "traefik.http.routers.stdb-writes.rule=Host(`stdb.3dvibegame.com`) && (Method(`POST`) || Method(`PUT`) || Method(`DELETE`) || Method(`PATCH`))"
        - "traefik.http.routers.stdb-writes.priority=1000"
        - "traefik.http.routers.stdb-writes.entrypoints=https"
        - "traefik.http.routers.stdb-writes.tls=true"
        - "traefik.http.routers.stdb-writes.service=stdb"
        - "traefik.http.routers.stdb-writes.middlewares=stdb-writeguard"
        # Allow writes only from these IPs; everyone else gets 403.
        # Use 127.0.0.1/32 to block ALL public writes (then publish via the SSH tunnel
        # below), or your office/home IP to keep publishing over the public domain.
        - "traefik.http.middlewares.stdb-writeguard.ipallowlist.sourcerange=127.0.0.1/32"
  ```

  Verify the `entrypoints` name (`https` on Coolify v4) and TLS/cert settings against
  Coolify's auto-generated labels — inspect them with
  `docker inspect <container> --format '{{json .Config.Labels}}'`. **Re-test that
  players still connect** (gameplay is `GET`/WS, so it should be unaffected) and that
  your own publish path still works.
- **Publish over an SSH tunnel** that bypasses the proxy and hits the container's local
  port directly (use this when `sourcerange` is `127.0.0.1/32`):

  ```bash
  # tunnel the VPS's local SpacetimeDB port to your machine
  ssh -N -L 3000:127.0.0.1:3000 youruser@your-vps &

  # publish through the tunnel; reuse your owner token so you stay the owner
  spacetime server add stdb-admin --url http://127.0.0.1:3000
  spacetime login --server-issued-login http://127.0.0.1:3000   # only if prompted; same server, same keys
  cd packages/world-backend
  spacetime publish --server http://127.0.0.1:3000 3dvibegame
  ```

  Alternatively, if you have a static IP, keep publishing via the public domain but add
  a Traefik **IPAllowList** middleware that restricts write methods to your IP.

- **Or block it at Cloudflare instead of Traefik (easiest rule).** If you'd rather not
  touch Traefik labels, put Cloudflare in front and block writes with one WAF rule:

  1. In Cloudflare **DNS**, switch the `stdb` record from grey to **Proxied (orange
     cloud)**.
  2. **SSL/TLS → Overview**, set the encryption mode to **Full (strict)**.
  3. The orange proxy intercepts the ACME HTTP-01 challenge, so Coolify's Let's
     Encrypt cert can't renew through it (it would silently expire in ~90 days). Fix
     this one of two ways:
     - create a **Cloudflare Origin Certificate** (SSL/TLS → Origin Server, ~15-year
       cert) and install it on the origin (Coolify custom cert), or
     - switch Coolify to a **DNS-01** ACME challenge (uses a Cloudflare API token
       instead of port 80).
  4. **Security → WAF → Custom rules → Create rule:**

     ```
     Field:    URI Path        Operator: starts with   Value: /v1/database/
     AND
     Field:    Request Method  Operator: is in         Value: POST PUT DELETE PATCH
     Action:   Block
     ```

     To keep publishing over the public domain from your IP, add
     `AND IP Source Address  is not  YOUR.PUBLIC.IP`.

  Cloudflare proxies WebSockets, so gameplay (the `GET` upgrade) still works. This
  trades the Traefik fiddliness for Cloudflare's TLS/cert handling — pick whichever
  side you'd rather manage. (Note: this contradicts the grey-cloud recommendation in
  step 0, so only do it once the cert handling above is sorted.)

### 3. Verify / monitor

`spacetime list --server https://stdb.3dvibegame.com` should show **only** `3dvibegame`.
Watch the `stdb-data` volume size — unexpected growth means someone got through.

---

## Gotchas

- **No per-player caps in the shared room.** The default room is private, and private
  worlds intentionally skip the per-player create/object guardrails. Every player can
  create unlimited objects (each is a Gemini call). Add limits before a wide public
  launch.
- **Deletion rules.** Released objects can be deleted in this private + destructive
  room, but for 90 seconds after creation only the creator may delete a fresh object.
- **Backups.** Snapshot the `stdb-data` volume to back up worlds.
