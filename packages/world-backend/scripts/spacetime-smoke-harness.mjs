#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const packageDir = resolve(scriptDir, "..");
export const repoRoot = resolve(packageDir, "../..");
export const fixturesDir = join(repoRoot, "packages/scene-runtime-demo/src/fixtures");

export async function createPublishedSmokeHarness({ dbPrefix }) {
  const harness = new SpacetimeSmokeHarness(dbPrefix);
  await harness.start();
  harness.loginAs("Smoke admin", "admin");
  harness.publish();
  return harness;
}

export function expectReducerFailure(action, messageFragment, failureMessage) {
  try {
    action();
  } catch (error) {
    if (String(error.message).includes(messageFragment)) {
      console.log(`expected rejection: ${failureMessage}`);
      return;
    }
    throw error;
  }

  throw new Error(`expected reducer failure: ${failureMessage}`);
}

export function expectIncludes(output, fragment, message) {
  assert(output.includes(fragment), `${message}\nOutput:\n${output}`);
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function jsonStringArg(filePath) {
  const normalizedJson = JSON.stringify(JSON.parse(readFileSync(filePath, "utf8")));
  return JSON.stringify(normalizedJson);
}

class SpacetimeSmokeHarness {
  constructor(dbPrefix) {
    this.database = `${dbPrefix}-${Date.now()}`;
    this.smokeRoot = mkdtempSync(join(tmpdir(), `${dbPrefix}-`));
    this.serverDataDir = join(this.smokeRoot, "spacetimedb-data");
    this.adminConfigPath = join(this.smokeRoot, "admin-cli.toml");
    this.serverProcess = null;
    this.serverOutput = "";
    this.serverUrl = "";
  }

  async start() {
    const port = await findOpenPort();
    this.serverUrl = `http://127.0.0.1:${port}`;
    this.serverProcess = this.startServer(port);
    await waitForPort(port);
  }

  publish() {
    this.runSpacetime(
      [
        `--config-path=${this.adminConfigPath}`,
        "publish",
        "--server",
        this.serverUrl,
        "--yes",
        this.database,
      ],
      {
        cwd: packageDir,
        label: "publish backend module",
      },
    );
  }

  loginAs(playerName, configName = playerName) {
    const configPath = join(this.smokeRoot, `${slug(configName)}-cli.toml`);
    this.runSpacetime(
      [
        `--config-path=${configPath}`,
        "login",
        "--server-issued-login",
        this.serverUrl,
        "--no-browser",
      ],
      {
        label: `create ${playerName} server-issued login`,
      },
    );

    return {
      name: playerName,
      configPath,
    };
  }

  callAs(player, reducerName, args) {
    return this.runSpacetime(
      [
        `--config-path=${player.configPath}`,
        "call",
        "--server",
        this.serverUrl,
        "--yes",
        "--",
        this.database,
        reducerName,
        ...args,
      ],
      {
        label: `${reducerName} as ${player.name}`,
      },
    );
  }

  query(sql) {
    return this.runSpacetime(
      [
        `--config-path=${this.adminConfigPath}`,
        "sql",
        "--server",
        this.serverUrl,
        "--yes",
        this.database,
        sql,
      ],
      {
        label: sql,
      },
    ).stdout;
  }

  activatePlayers() {
    this.query("UPDATE player_session SET presence_state = 'active'");
  }

  dispose() {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
    }
    rmSync(this.smokeRoot, { force: true, recursive: true });
  }

  startServer(port) {
    const child = spawn(
      "spacetime",
      [
        "start",
        "--listen-addr",
        `127.0.0.1:${port}`,
        "--data-dir",
        this.serverDataDir,
        "--in-memory",
        "--non-interactive",
      ],
      {
        cwd: packageDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (chunk) => {
      this.serverOutput += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      this.serverOutput += chunk.toString();
    });

    child.on("exit", (code, signal) => {
      if (code !== null && code !== 0 && !signal) {
        this.serverOutput += `\nspacetime start exited with code ${code}\n`;
      }
    });

    return child;
  }

  runSpacetime(args, { cwd = repoRoot, label }) {
    const result = spawnSync("spacetime", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });

    if (result.error || result.status !== 0) {
      const details = [
        `command failed: spacetime ${args.join(" ")}`,
        label ? `step: ${label}` : null,
        result.error ? `error: ${result.error.message}` : null,
        result.stdout ? `stdout:\n${result.stdout}` : null,
        result.stderr ? `stderr:\n${result.stderr}` : null,
        this.serverOutput ? `server output:\n${this.serverOutput}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      throw new Error(details);
    }

    return result;
  }
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findOpenPort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function waitForPort(port) {
  const deadline = Date.now() + 10_000;

  return new Promise((resolvePort, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolvePort();
      });
      socket.once("error", (error) => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for SpacetimeDB on port ${port}: ${error.message}`));
          return;
        }
        setTimeout(tryConnect, 100);
      });
    };

    tryConnect();
  });
}
