#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "../..");
const fixturesDir = join(repoRoot, "packages/scene-runtime-demo/src/fixtures");
const smokeObjectId = "lock-smoke-object";
const dbName = `vibe-world-lock-smoke-${Date.now()}`;
const smokeRoot = mkdtempSync(join(tmpdir(), "vibe-world-lock-smoke-"));
const serverDataDir = join(smokeRoot, "spacetimedb-data");
const adminConfigPath = join(smokeRoot, "admin-cli.toml");
const aliceConfigPath = join(smokeRoot, "alice-cli.toml");
const bobConfigPath = join(smokeRoot, "bob-cli.toml");

let serverProcess = null;
let serverOutput = "";

try {
  const port = await findOpenPort();
  const serverUrl = `http://127.0.0.1:${port}`;

  serverProcess = startServer(port);
  await waitForPort(port);

  loginAs(adminConfigPath, serverUrl, "Smoke admin");

  runSpacetime([`--config-path=${adminConfigPath}`, "publish", "--server", serverUrl, "--yes", dbName], {
    cwd: packageDir,
    label: "publish backend module",
  });

  loginAs(aliceConfigPath, serverUrl, "Alice");
  loginAs(bobConfigPath, serverUrl, "Bob");

  callAs(aliceConfigPath, serverUrl, dbName, "join_world", ["Alice"]);
  callAs(bobConfigPath, serverUrl, dbName, "join_world", ["Bob"]);
  activatePlayers(serverUrl, dbName);

  const playersOutput = query(
    serverUrl,
    dbName,
    "SELECT identity, nickname, presence_state FROM player_session",
  );
  const identities = [...new Set(playersOutput.match(/0x[0-9a-f]{64}/g) ?? [])];
  assert(identities.length === 2, "expected two distinct anonymous player identities");
  expectIncludes(playersOutput, '"Alice"', "Alice should be present");
  expectIncludes(playersOutput, '"Bob"', "Bob should be present");

  callAs(aliceConfigPath, serverUrl, dbName, "request_create_object", [
    "lock-smoke-create-job",
    "create a pine tree",
  ]);
  activatePlayers(serverUrl, dbName);

  callAs(aliceConfigPath, serverUrl, dbName, "submit_ai_draft", [
    "lock-smoke-create-job",
    smokeObjectId,
    jsonStringArg(join(fixturesDir, "pine-tree.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree.builder.json")),
  ]);
  activatePlayers(serverUrl, dbName);

  callAs(aliceConfigPath, serverUrl, dbName, "release_object", [smokeObjectId]);
  activatePlayers(serverUrl, dbName);

  callAs(aliceConfigPath, serverUrl, dbName, "request_edit_lock", [smokeObjectId, "1"]);
  activatePlayers(serverUrl, dbName);

  const lockedOutput = query(
    serverUrl,
    dbName,
    `SELECT object_id, state, version, lock_owner FROM world_object WHERE object_id = '${smokeObjectId}'`,
  );
  expectIncludes(lockedOutput, '"edit_locked"', "Alice should hold the edit lock");

  expectReducerFailure(
    () => callAs(bobConfigPath, serverUrl, dbName, "request_edit_lock", [smokeObjectId, "1"]),
    "expected public but got edit_locked",
    "Bob should not acquire a second edit lock",
  );
  activatePlayers(serverUrl, dbName);

  expectReducerFailure(
    () =>
      callAs(bobConfigPath, serverUrl, dbName, "update_locked_transform", [
        smokeObjectId,
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "1",
        "1",
        "1",
      ]),
    "only the lock owner can update locked transform",
    "Bob should not mutate Alice's locked object",
  );
  activatePlayers(serverUrl, dbName);

  expectReducerFailure(
    () =>
      callAs(bobConfigPath, serverUrl, dbName, "submit_object_edit", [
        smokeObjectId,
        "1",
        jsonStringArg(join(fixturesDir, "pine-tree-edit.voxel-builder.json")),
        jsonStringArg(join(fixturesDir, "pine-tree-edit.builder.json")),
      ]),
    "only the lock owner can submit an edit",
    "Bob should not submit Alice's locked edit",
  );
  activatePlayers(serverUrl, dbName);

  callAs(aliceConfigPath, serverUrl, dbName, "submit_object_edit", [
    smokeObjectId,
    "1",
    jsonStringArg(join(fixturesDir, "pine-tree-edit.voxel-builder.json")),
    jsonStringArg(join(fixturesDir, "pine-tree-edit.builder.json")),
  ]);

  const editedOutput = query(
    serverUrl,
    dbName,
    `SELECT object_id, state, version, lock_owner FROM world_object WHERE object_id = '${smokeObjectId}'`,
  );
  expectIncludes(editedOutput, '"cooldown"', "Alice's submitted edit should enter cooldown");
  expectIncludes(editedOutput, " 2 ", "Alice's edit should increment the object version");

  const locksOutput = query(serverUrl, dbName, "SELECT object_id, lock_type FROM object_lock");
  assert(!locksOutput.includes(smokeObjectId), "submitted edit should clear the active object lock");

  console.log("lock-contention smoke passed");
  console.log(`database: ${dbName}`);
  console.log(`alice: ${identities[0]}`);
  console.log(`bob:   ${identities[1]}`);
} finally {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  rmSync(smokeRoot, { force: true, recursive: true });
}

function startServer(port) {
  const child = spawn(
    "spacetime",
    [
      "start",
      "--listen-addr",
      `127.0.0.1:${port}`,
      "--data-dir",
      serverDataDir,
      "--in-memory",
      "--non-interactive",
    ],
    {
      cwd: packageDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0 && !signal) {
      serverOutput += `\nspacetime start exited with code ${code}\n`;
    }
  });

  return child;
}

function callAs(configPath, serverUrl, database, reducerName, args) {
  return runSpacetime(
    [
      `--config-path=${configPath}`,
      "call",
      "--server",
      serverUrl,
      "--yes",
      database,
      reducerName,
      ...args,
    ],
    {
      label: `${reducerName} as ${configPath === aliceConfigPath ? "Alice" : "Bob"}`,
    },
  );
}

function loginAs(configPath, serverUrl, playerName) {
  runSpacetime(
    [
      `--config-path=${configPath}`,
      "login",
      "--server-issued-login",
      serverUrl,
      "--no-browser",
    ],
    {
      label: `create ${playerName} server-issued login`,
    },
  );
}

function query(serverUrl, database, sql) {
  return runSpacetime(
    [`--config-path=${adminConfigPath}`, "sql", "--server", serverUrl, "--yes", database, sql],
    {
      label: sql,
    },
  ).stdout;
}

function activatePlayers(serverUrl, database) {
  runSpacetime(
    [
      `--config-path=${adminConfigPath}`,
      "sql",
      "--server",
      serverUrl,
      "--yes",
      database,
      "UPDATE player_session SET presence_state = 'active'",
    ],
    {
      label: "activate CLI smoke players",
    },
  );
}

function runSpacetime(args, { cwd = repoRoot, label }) {
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
      serverOutput ? `server output:\n${serverOutput}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(details);
  }

  return result;
}

function expectReducerFailure(action, messageFragment, failureMessage) {
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

function expectIncludes(output, fragment, message) {
  assert(output.includes(fragment), `${message}\nOutput:\n${output}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function jsonStringArg(filePath) {
  const normalizedJson = JSON.stringify(JSON.parse(readFileSync(filePath, "utf8")));
  return JSON.stringify(normalizedJson);
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
