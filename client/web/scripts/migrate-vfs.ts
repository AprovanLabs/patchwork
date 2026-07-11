#!/usr/bin/env node
/**
 * One-shot VFS migration script.
 *
 * Walks the local ./workspace/<wsId> directory and issues PUT requests against
 * the target VFS endpoint for every file found. Use this to seed a dev fixture
 * workspace into the AWS backend before flipping VFS_BACKEND=aws.
 *
 * Usage:
 *   VFS_URL=https://chat.api.yourenv.com \
 *   AUTH_TOKEN=<cognito-id-token> \
 *   pnpm tsx scripts/migrate-vfs.ts <wsId> [--workspace-dir ./workspace]
 *
 * Dry-run (list files without uploading):
 *   pnpm tsx scripts/migrate-vfs.ts <wsId> --dry-run
 */

import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const wsId = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const wsDirArg = args.find((a) => a.startsWith("--workspace-dir="))?.slice("--workspace-dir=".length);
  const workspaceDir = wsDirArg ?? "./workspace";

  if (!wsId) {
    console.error("Usage: migrate-vfs.ts <wsId> [--dry-run] [--workspace-dir=./workspace]");
    process.exit(1);
  }

  const vfsUrl = process.env["VFS_URL"];
  const authToken = process.env["AUTH_TOKEN"];

  if (!dryRun) {
    if (!vfsUrl) {
      console.error("Set VFS_URL to the base URL of the target VFS server (e.g. https://chat.api.yourenv.com)");
      process.exit(1);
    }
    if (!authToken) {
      console.error("Set AUTH_TOKEN to a valid Cognito ID token");
      process.exit(1);
    }
  }

  const wsLocalDir = join(workspaceDir, wsId);

  let files: string[];
  try {
    const s = await stat(wsLocalDir);
    if (!s.isDirectory()) {
      console.error(`${wsLocalDir} is not a directory`);
      process.exit(1);
    }
    files = await collectFiles(wsLocalDir);
  } catch {
    console.error(`Workspace directory not found: ${wsLocalDir}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No files found — nothing to migrate.");
    return;
  }

  console.log(`Found ${files.length} file(s) in ${wsLocalDir}`);
  if (dryRun) {
    for (const f of files) {
      console.log("  [dry-run]", relative(wsLocalDir, f));
    }
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const filePath of files) {
    const relativePath = relative(wsLocalDir, filePath);
    const content = await readFile(filePath, "utf-8");
    const url = `${vfsUrl}/vfs/${relativePath}`;

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: content,
      });

      if (res.ok) {
        console.log("  ✓", relativePath);
        ok++;
      } else {
        const body = await res.text().catch(() => "(no body)");
        console.error(`  ✗ ${relativePath} — HTTP ${res.status}: ${body}`);
        failed++;
      }
    } catch (err) {
      console.error(`  ✗ ${relativePath} — ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} uploaded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
