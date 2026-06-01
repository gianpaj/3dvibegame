#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

import {
  createPublishedSmokeHarness,
  repoRoot,
} from "../../world-backend/scripts/spacetime-smoke-harness.mjs";

export async function runLiveDemoBrowserSmoke({
  dbPrefix,
  nickname = "Browser Smoke",
  setupBackend,
  viteEnv = {},
  run,
}) {
  const harness = await createPublishedSmokeHarness({ dbPrefix });
  const processes = [];
  const tempRoots = [];
  let page = null;

  try {
    await setupBackend?.(harness);

    const vitePort = await findOpenPort();
    const vite = startVite(vitePort, harness, nickname, viteEnv);
    processes.push(vite);
    await waitForHttp(
      `http://127.0.0.1:${vitePort}/`,
      "Vite dev server",
      15_000,
      () => vite.smokeOutput?.() ?? "",
    );

    const browser = await startChromium();
    processes.push(browser.process);
    tempRoots.push(browser.userDataDir);
    page = await createCdpPage(browser.remotePort, `http://127.0.0.1:${vitePort}/`);

    await run({
      appUrl: `http://127.0.0.1:${vitePort}/`,
      harness,
      page,
    });
  } finally {
    if (page) {
      page.close();
    }
    for (const child of processes.reverse()) {
      await stopProcess(child);
    }
    harness.dispose();
    for (const root of tempRoots) {
      safeRm(root);
    }
  }
}

export function waitForLiveBackendHud(page, timeoutMs = 20_000) {
  return page.waitForExpression(
    `(() => {
      const shell = document.querySelector('[data-role="hud-shell"]');
      const sync = document.querySelector('[data-role="sync-pill"]');
      return shell?.dataset.multiplayer === "live" &&
        sync?.textContent?.includes("Backend live");
    })()`,
    "live backend HUD connection",
    timeoutMs,
  );
}

function startVite(port, harness, nickname, viteEnv) {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@3dvibegame/scene-runtime-demo",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_PLAYER_NICKNAME: nickname,
        VITE_SPACETIMEDB_DATABASE: harness.database,
        VITE_SPACETIMEDB_URI: harness.serverUrl,
        ...viteEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  attachProcessLog(child, "vite");
  return child;
}

async function startChromium() {
  const executable = resolveChromiumExecutable();
  const remotePort = await findOpenPort();
  const userDataDir = mkdtempSync(join(tmpdir(), "vibe-world-browser-smoke-"));
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-default-browser-check",
      "--no-first-run",
      "--use-angle=swiftshader",
      "--use-gl=angle",
      `--remote-debugging-port=${remotePort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  attachProcessLog(child, "chromium");
  await waitForHttp(
    `http://127.0.0.1:${remotePort}/json/version`,
    "Chromium remote debugging",
  );
  return { process: child, remotePort, userDataDir };
}

function resolveChromiumExecutable() {
  if (process.env.CHROMIUM_PATH && isUsableBrowser(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  for (const candidate of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ]) {
    if (isUsableBrowser(candidate)) {
      return candidate;
    }
  }

  for (const candidate of ["chromium", "google-chrome", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    const executable = result.stdout.trim();
    if (result.status === 0 && executable && isUsableBrowser(executable)) {
      return executable;
    }
  }

  throw new Error("Chromium executable not found. Set CHROMIUM_PATH to run this smoke.");
}

function isUsableBrowser(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0;
}

function attachProcessLog(child, label) {
  let output = "";
  child.smokeOutput = () => output.slice(-4_000);
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== 143 && signal !== "SIGTERM") {
      process.stderr.write(`${label} exited with ${code ?? signal}\n${output}\n`);
    }
  });
}

async function createCdpPage(remotePort, url) {
  const target = await createChromeTarget(remotePort);
  const page = await CdpPage.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  page.captureBrowserErrors();

  const loaded = page.waitForEvent("Page.loadEventFired", 15_000);
  await page.send("Page.navigate", { url });
  await loaded;
  return page;
}

async function createChromeTarget(remotePort) {
  const response = await fetch(`http://127.0.0.1:${remotePort}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`failed to create Chromium target: HTTP ${response.status}`);
  }
  return response.json();
}

class CdpPage {
  static connect(webSocketDebuggerUrl) {
    return new Promise((resolvePage, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      const page = new CdpPage(socket);
      socket.addEventListener("open", () => resolvePage(page), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("failed to connect to Chromium CDP")),
        { once: true },
      );
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.browserErrors = [];

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.callbacks.has(message.id)) {
        const { resolveMessage, rejectMessage } = this.callbacks.get(message.id);
        this.callbacks.delete(message.id);
        if (message.error) {
          rejectMessage(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
          return;
        }
        resolveMessage(message.result ?? {});
        return;
      }

      if (message.method) {
        for (const listener of this.eventListeners.get(message.method) ?? []) {
          listener(message.params ?? {});
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolveMessage, rejectMessage) => {
      this.callbacks.set(id, { resolveMessage, rejectMessage });
      this.socket.send(payload);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`browser evaluation failed: ${exceptionText(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  async click(selector, label) {
    await this.evaluate(
      `(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!(target instanceof HTMLElement)) {
          throw new Error(${JSON.stringify(`${label} control not found`)});
        }
        target.click();
        return true;
      })()`,
    );
  }

  async waitForExpression(expression, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let lastValue = null;
    while (Date.now() < deadline) {
      lastValue = await this.evaluate(expression);
      if (lastValue) {
        return lastValue;
      }
      await delay(100);
    }
    const debug = await this.debugSnapshot();
    throw new Error(
      `timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}\n` +
        `debug: ${JSON.stringify(debug)}\n` +
        `browser errors: ${this.browserErrors.join("\n") || "none"}`,
    );
  }

  waitForEvent(method, timeoutMs) {
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => {
        remove();
        reject(new Error(`timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const listener = (params) => {
        clearTimeout(timeout);
        remove();
        resolveEvent(params);
      };
      const listeners = this.eventListeners.get(method) ?? [];
      listeners.push(listener);
      this.eventListeners.set(method, listeners);
      const remove = () => {
        this.eventListeners.set(
          method,
          (this.eventListeners.get(method) ?? []).filter((candidate) => candidate !== listener),
        );
      };
    });
  }

  captureBrowserErrors() {
    this.addEventListener("Runtime.exceptionThrown", (params) => {
      this.browserErrors.push(exceptionText(params.exceptionDetails));
    });
    this.addEventListener("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error" || params.type === "assert") {
        this.browserErrors.push(
          params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ") ??
            "console error",
        );
      }
    });
  }

  addEventListener(method, listener) {
    const listeners = this.eventListeners.get(method) ?? [];
    listeners.push(listener);
    this.eventListeners.set(method, listeners);
  }

  assertNoBrowserErrors() {
    if (this.browserErrors.length) {
      throw new Error(`browser errors observed:\n${this.browserErrors.join("\n")}`);
    }
  }

  async debugSnapshot() {
    return this.evaluate(
      `(() => ({
        context: document.querySelector('[data-role="context-message"]')?.textContent ?? "",
        contextState: document.querySelector('[data-role="context-message"]')?.dataset.state ?? "",
        multiplayer: document.querySelector('[data-role="hud-shell"]')?.dataset.multiplayer ?? "",
        presence: document.querySelector('[data-role="presence-pill"]')?.textContent ?? "",
        room: document.querySelector('[data-role="room-subtitle"]')?.textContent ?? "",
        stage: document.querySelector('[data-role="stage-pill"]')?.textContent ?? "",
        stageWorkflow: document.querySelector('[data-role="stage-pill"]')?.dataset.workflow ?? "",
        sync: document.querySelector('[data-role="sync-pill"]')?.textContent ?? "",
      }))()`,
    ).catch((error) => ({ debugError: error.message }));
  }

  close() {
    this.socket.close();
  }
}

function exceptionText(exceptionDetails) {
  return (
    exceptionDetails?.exception?.description ??
    exceptionDetails?.text ??
    exceptionDetails?.exception?.value ??
    "unknown browser exception"
  );
}

export async function waitForHttp(
  url,
  label,
  timeoutMs = 15_000,
  debugOutput = () => "",
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  const debug = debugOutput();
  throw new Error(
    `timed out waiting for ${label}: ${lastError?.message ?? "unknown error"}${
      debug ? `\n\n${label} output:\n${debug}` : ""
    }`,
  );
}

export function findOpenPort() {
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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  if (await waitForExit(child, 2_000)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

function safeRm(path) {
  try {
    rmSync(path, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 150,
    });
  } catch (error) {
    console.warn(`warning: failed to remove temp path ${path}: ${error.message}`);
  }
}
