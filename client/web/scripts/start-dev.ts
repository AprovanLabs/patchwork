#!/usr/bin/env node
import "dotenv/config";
/**
 * Development server starter with dynamic port allocation.
 *
 * Allocates consecutive ports for all services and starts them together.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { allocatePorts } from "@aprovan/devtools";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT = process.env.PROJECT ?? "patchwork";
const BASE_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3700;

async function main() {
  console.log(`\n🧵 Starting ${PROJECT} dev services...\n`);

  const { base, ports } = await allocatePorts({
    base: BASE_PORT,
    count: 2,
  });

  const [clientPort, serverPort] = ports;

  console.log(`📍 Allocated port range: ${base}-${base + 2}`);
  console.log(`   Client:     http://127.0.0.1:${clientPort}`);
  console.log(`   Server:     http://127.0.0.1:${serverPort}`);

  const env = {
    ...process.env,
    CLIENT_PORT: String(clientPort),
    SERVER_PORT: String(serverPort),
    API_URL: `http://127.0.0.1:${serverPort}`,
  };

  const chatApiDir = path.resolve(__dirname, "../../../apps/chat-api");
  const server = spawn("pnpm", ["run", "dev"], {
    stdio: "inherit",
    env: { ...env, PORT: String(serverPort) },
    cwd: chatApiDir,
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const vite = spawn("pnpm", ["exec", "vite", "--port", String(clientPort)], {
    stdio: "inherit",
    env,
  });

  const cleanup = () => {
    console.log("\n🛑 Shutting down...");
    server.kill();
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
