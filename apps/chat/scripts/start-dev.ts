#!/usr/bin/env node
import "dotenv/config";
/**
 * Development server starter with dynamic port allocation.
 *
 * Allocates consecutive ports for all services and starts them together.
 */

import { spawn } from "node:child_process";
import { allocatePorts } from "@aprovan/devtools";

const PROJECT = process.env.PROJECT ?? "patchwork";
const BASE_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3700;

async function main() {
  console.log(`\n🧵 Starting ${PROJECT} dev services...\n`);

  const { base, ports } = await allocatePorts({
    base: BASE_PORT,
    count: 2,
  });

  const [clientPort, stitcheryPort] = ports;

  console.log(`📍 Allocated port range: ${base}-${base + 2}`);
  console.log(`   Client:     http://127.0.0.1:${clientPort}`);
  console.log(`   Stitchery:  http://127.0.0.1:${stitcheryPort}`);

  // Export ports for child processes
  const env = {
    ...process.env,
    CLIENT_PORT: String(clientPort),
    STITCHERY_PORT: String(stitcheryPort),
    STITCHERY_URL: `http://127.0.0.1:${stitcheryPort}`,
  };

  // Start stitchery
  const stitcheryArgs = [
    "node",
    "../../packages/stitchery/dist/cli.js",
    "serve",
    "-p",
    String(stitcheryPort),
    "--utcp-config",
    ".utcp_config.json",
    "--local-package",
    "@aprovan/patchwork-image-shadcn:../../packages/images/shadcn",
    "-v",
    "--vfs-dir",
    "./workspace",
    "--vfs-use-paths",
  ];

  const stitchery = spawn(stitcheryArgs[0]!, stitcheryArgs.slice(1), {
    stdio: "inherit",
    env,
  });

  // Give stitchery a moment to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start vite client
  const vite = spawn("pnpm", ["exec", "vite", "--port", String(clientPort)], {
    stdio: "inherit",
    env,
  });

  // Handle shutdown
  const cleanup = () => {
    console.log("\n🛑 Shutting down...");
    stitchery.kill();
    vite.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
