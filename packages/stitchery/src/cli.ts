#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { createStitcheryServer } from './server/index.js';

const program = new Command();

program
  .name('stitchery')
  .description('Backend services for LLM-generated artifacts')
  .version('0.1.0');

program
  .command('serve')
  .description('Start the stitchery server')
  .option('-p, --port <port>', 'Port to listen on', '6434')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .option(
    '--copilot-proxy-url <url>',
    'Copilot proxy URL',
    'http://127.0.0.1:6433/v1',
  )
  .option(
    '--mcp <servers...>',
    'MCP server commands (format: name:command:arg1,arg2)',
  )
  .option('--utcp-config <path>', 'Load UTCP configuration from JSON file')
  .option(
    '--local-package <packages...>',
    'Local package overrides (format: name:path)',
  )
  .option(
    '--vfs-dir <path>',
    'Directory for virtual file system storage',
    '.working/widgets',
  )
  .option(
    '--vfs-use-paths',
    'Use file paths from code blocks instead of UUIDs for VFS storage',
  )
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      console.log('[stitchery] CLI options:', JSON.stringify(options, null, 2));
    }

    const mcpServers = (options.mcp ?? []).map((spec: string) => {
      const [name, command, ...rest] = spec.split(':');
      const rawArgs = rest.join(':').split(',').filter(Boolean);
      // Resolve relative paths in args
      const args = rawArgs.map((arg) =>
        arg.startsWith('.') ? path.resolve(process.cwd(), arg) : arg,
      );
      return { name, command, args };
    });

    const localPackages: Record<string, string> = {};
    for (const spec of options.localPackage ?? []) {
      const [name, ...pathParts] = spec.split(':');
      const pkgPath = pathParts.join(':');
      localPackages[name] = path.resolve(process.cwd(), pkgPath);
    }

    // Load UTCP config from file if specified
    let utcpConfig;
    if (options.utcpConfig) {
      const utcpPath = path.resolve(process.cwd(), options.utcpConfig);
      if (!fs.existsSync(utcpPath)) {
        console.error(`UTCP config file not found: ${utcpPath}`);
        process.exit(1);
      }
      try {
        const content = fs.readFileSync(utcpPath, 'utf-8');
        utcpConfig = JSON.parse(content);
        if (options.verbose) {
          console.log('[stitchery] Loaded UTCP config from:', utcpPath);
        }
      } catch (err) {
        console.error(`Failed to parse UTCP config: ${err}`);
        process.exit(1);
      }
    }

    // Resolve VFS directory path
    const vfsDir = options.vfsDir
      ? path.resolve(process.cwd(), options.vfsDir)
      : undefined;

    if (vfsDir && options.verbose) {
      console.log('[stitchery] VFS directory:', vfsDir);
    }

    const server = await createStitcheryServer({
      port: parseInt(options.port, 10),
      host: options.host,
      copilotProxyUrl: options.copilotProxyUrl,
      mcpServers,
      localPackages,
      utcp: utcpConfig,
      vfsDir,
      vfsUsePaths: options.vfsUsePaths ?? false,
      verbose: options.verbose,
    });

    const { port, host } = await server.start();
    console.log(`Stitchery server running at http://${host}:${port}`);

    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    });
  });

program.parse();
