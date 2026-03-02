#!/usr/bin/env node
import path from "path";
import fs from "fs";
import { Command } from "commander";
import { getAvailablePort } from "@aprovan/devtools";
import { createStitcheryServer } from "./server/index.js";

const program = new Command();

program
  .name("stitchery")
  .description("Backend services for LLM-generated artifacts")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the stitchery server")
  .option(
    "-p, --port <port>",
    "Port to listen on (auto-finds available if in use)",
    "6434",
  )
  .option("-h, --host <host>", "Host to bind to", "127.0.0.1")
  .option(
    "--copilot-proxy-url <url>",
    "Copilot proxy URL",
    "http://127.0.0.1:6433/v1",
  )
  .option("--strict", "Fail if the specified port is in use", false)
  .option(
    "--mcp <servers...>",
    "MCP server commands (format: name:command:arg1,arg2)",
  )
  .option(
    "--local-package <packages...>",
    "Local package overrides (format: name:path)",
  )
  .option("--vfs-dir <path>", "Directory for virtual file system storage", ".")
  .option(
    "--vfs-use-paths",
    "Use file paths from code blocks instead of UUIDs for VFS storage",
  )
  .option("--data-dir <path>", "Directory for SQLite databases and persistent data")
  .option("--skills-dir <path>", "Directory containing SKILL.md files")
  .option("--enable-events", "Enable unified event system")
  .option("--enable-orchestrator", "Enable orchestrator for event-driven skills")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (options) => {
    if (options.verbose) {
      console.log("[stitchery] CLI options:", JSON.stringify(options, null, 2));
    }

    // Auto-find available port unless --strict
    let port = parseInt(options.port, 10);
    if (!options.strict) {
      port = await getAvailablePort(port);
    }

    const mcpServers = (options.mcp ?? []).map((spec: string) => {
      const [name, command, ...rest] = spec.split(":");
      const rawArgs = rest.join(":").split(",").filter(Boolean);
      // Resolve relative paths in args
      const args = rawArgs.map((arg) =>
        arg.startsWith(".") ? path.resolve(process.cwd(), arg) : arg,
      );
      return { name, command, args };
    });

    const localPackages: Record<string, string> = {};
    for (const spec of options.localPackage ?? []) {
      const [name, ...pathParts] = spec.split(":");
      const pkgPath = pathParts.join(":");
      localPackages[name] = path.resolve(process.cwd(), pkgPath);
    }

    // Resolve VFS directory path
    const vfsDir = options.vfsDir
      ? path.resolve(process.cwd(), options.vfsDir)
      : undefined;

    if (vfsDir && options.verbose) {
      console.log("[stitchery] VFS directory:", vfsDir);
    }

    // Resolve data and skills directories
    const dataDir = options.dataDir
      ? path.resolve(process.cwd(), options.dataDir)
      : undefined;
    const skillsDir = options.skillsDir
      ? path.resolve(process.cwd(), options.skillsDir)
      : undefined;

    // Create data directory if it doesn't exist
    if (dataDir && options.enableEvents) {
      fs.mkdirSync(dataDir, { recursive: true });
      if (options.verbose) {
        console.log("[stitchery] Data directory:", dataDir);
      }
    }

    if (skillsDir && options.verbose) {
      console.log("[stitchery] Skills directory:", skillsDir);
    }

    const server = await createStitcheryServer({
      port,
      host: options.host,
      copilotProxyUrl: options.copilotProxyUrl,
      mcpServers,
      localPackages,
      vfsDir,
      vfsUsePaths: options.vfsUsePaths ?? false,
      dataDir,
      skillsDir,
      enableEvents: options.enableEvents ?? false,
      enableOrchestrator: options.enableOrchestrator ?? false,
      verbose: options.verbose,
    });

    const addr = await server.start();
    console.log(`Stitchery server running at http://${addr.host}:${addr.port}`);

    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await server.stop();
      process.exit(0);
    });
  });

program.parse();
