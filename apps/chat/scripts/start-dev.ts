#!/usr/bin/env node
/**
 * Development server starter with dynamic port allocation.
 *
 * Allocates consecutive ports for all services and starts them together.
 */

import { spawn } from "node:child_process";
import { allocatePorts, PROJECT_BASES, SERVICE_OFFSETS } from "@aprovan/copilot-proxy";

const PROJECT = process.env.PROJECT ?? "patchwork";
const BASE_PORT = PROJECT_BASES[PROJECT as keyof typeof PROJECT_BASES] ?? 3500;

async function main() {
  console.log(`\n🧵 Starting ${PROJECT} dev services...\n`);

  const { base, ports } = await allocatePorts({
    base: BASE_PORT,
    count: 3,
    increment: 10,
  });

  const [clientPort, stitcheryPort, proxyPort] = ports;

  console.log(`📍 Allocated port range: ${base}-${base + 2}`);
  console.log(`   Client:     http://127.0.0.1:${clientPort}`);
  console.log(`   Stitchery:  http://127.0.0.1:${stitcheryPort}`);
  console.log(`   Proxy:      http://127.0.0.1:${proxyPort}\n`);

  // Export ports for child processes
  const env = {
    ...process.env,
    CLIENT_PORT: String(clientPort),
    STITCHERY_PORT: String(stitcheryPort),
    PROXY_PORT: String(proxyPort),
    STITCHERY_URL: `http://127.0.0.1:${stitcheryPort}`,
    COPILOT_PROXY_URL: `http://127.0.0.1:${proxyPort}/v1`,
  };

  // Start proxy first
  const proxy = spawn("pnpm", ["exec", "copilot-proxy", "serve", "-p", String(proxyPort), "--strict"], {
    stdio: "inherit",
    env,
  });

  // Give proxy a moment to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Start stitchery
  const stitcheryArgs = [
    "node", "../../packages/stitchery/dist/cli.js", "serve",
    "-p", String(stitcheryPort),
    "--strict",
    "--copilot-proxy-url", `http://127.0.0.1:${proxyPort}/v1`,
    "--utcp-config", ".utcp_config.json",
    "--local-package", "@aprovan/patchwork-image-shadcn:../../packages/images/shadcn",
    "-v",
    "--vfs-dir", "./workspace",
    "--vfs-use-paths",
  ];

  const stitchery = spawn(stitcheryArgs[0], stitcheryArgs.slice(1), {
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
    proxy.kill();
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
