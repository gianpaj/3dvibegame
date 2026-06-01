#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const commands = [
  {
    label: "AI worker fake create",
    args: ["--filter", "@3dvibegame/ai-worker", "smoke:fake-create"],
  },
  {
    label: "AI worker optional Gemini live",
    args: ["--filter", "@3dvibegame/ai-worker", "smoke:gemini-live"],
  },
  {
    label: "Backend first-playable flow",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:first-playable-flow"],
  },
  {
    label: "Backend 20-player replay",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:multiplayer-20"],
  },
  {
    label: "Backend lock contention",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:lock-contention"],
  },
  {
    label: "Backend private destructive edit",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:private-destructive-edit"],
  },
  {
    label: "Backend archive reset",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:archive-reset"],
  },
  {
    label: "Backend AI job failure",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:ai-job-failure"],
  },
  {
    label: "Backend world settings",
    args: ["--filter", "@3dvibegame/world-backend", "smoke:world-settings"],
  },
  {
    label: "Browser first-playable live flow",
    args: ["--filter", "@3dvibegame/scene-runtime-demo", "smoke:live-first-playable"],
  },
  {
    label: "Browser archive read-only",
    args: ["--filter", "@3dvibegame/scene-runtime-demo", "smoke:live-archive-readonly"],
  },
  {
    label: "Browser HTTP AI worker flow",
    args: ["--filter", "@3dvibegame/scene-runtime-demo", "smoke:live-http-ai-worker"],
  },
];

for (const [index, command] of commands.entries()) {
  console.log(`\n[${index + 1}/${commands.length}] ${command.label}`);
  const result = spawnSync("pnpm", command.args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nPhase 3 smoke suite passed");
