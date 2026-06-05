import { spawn, type ChildProcess } from "node:child_process";
import { log, error } from "./logger.js";

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;

/**
 * Start a cloudflare tunnel to expose a local port publicly.
 * Returns the public URL once the tunnel is established.
 */
export async function startTunnel(port: number): Promise<string> {
  if (tunnelUrl) return tunnelUrl;

  return new Promise((resolve, reject) => {
    const args = ["tunnel", "--url", `http://localhost:${port}`];

    log("tunnel", `Starting cloudflared tunnel for port ${port}...`);

    tunnelProcess = spawn("cloudflared", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Tunnel startup timed out after 30s"));
      }
    }, 30000);

    const handleOutput = (data: Buffer) => {
      const text = data.toString();

      // Look for the tunnel URL in the output
      // cloudflared outputs: "https://xxx.trycloudflare.com"
      const urlMatch = text.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
      if (urlMatch && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        tunnelUrl = urlMatch[0];
        log("tunnel", `Tunnel established: ${tunnelUrl}`);
        resolve(tunnelUrl);
      }
    };

    tunnelProcess.stdout?.on("data", handleOutput);
    tunnelProcess.stderr?.on("data", handleOutput);

    tunnelProcess.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        error("tunnel", "Failed to start cloudflared:", err);
        reject(err);
      }
    });

    tunnelProcess.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}`));
      }
      tunnelProcess = null;
      tunnelUrl = null;
    });
  });
}

/**
 * Stop the cloudflare tunnel if running.
 */
export function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
    tunnelUrl = null;
  }
}

/**
 * Get the current tunnel URL if available.
 */
export function getTunnelUrl(): string | null {
  return tunnelUrl;
}
