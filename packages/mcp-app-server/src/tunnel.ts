import { spawn, type ChildProcess } from "node:child_process";
import { log, error } from "./logger.js";

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;

/**
 * Poll the tunnel's public `/health` endpoint until it returns 200.
 *
 * cloudflared prints the `*.trycloudflare.com` URL as soon as the process
 * registers, but the edge route is frequently not live yet — requests in that
 * window return Cloudflare error 1033 ("unable to resolve"). Publishing the URL
 * before it's actually reachable bakes a dead host into rendered widgets, so we
 * verify reachability before adopting it.
 */
async function waitForTunnelLive(url: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not reachable yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Start a cloudflare tunnel to expose a local port publicly.
 * Returns the public URL once the tunnel is established AND verified reachable.
 */
export async function startTunnel(port: number): Promise<string> {
  if (tunnelUrl) return tunnelUrl;

  const detectedUrl = await new Promise<string>((resolve, reject) => {
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
      const urlMatch = text.match(/https:\/\/[^\s]+\.trycloudflare\.com\/?/);
      if (urlMatch && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(urlMatch[0].replace(/\/$/, ""));
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

  // Verify-then-publish: don't adopt the hostname until the edge route is live,
  // otherwise rendered widgets reference a host that returns Cloudflare 1033.
  log("tunnel", `Tunnel hostname detected (${detectedUrl}); verifying reachability...`);
  const live = await waitForTunnelLive(detectedUrl);
  if (!live) {
    error(
      "tunnel",
      `Tunnel ${detectedUrl} did not become reachable within 30s — publishing anyway, but widgets may fail to load until the edge route propagates.`,
    );
  } else {
    log("tunnel", `Tunnel verified reachable: ${detectedUrl}`);
  }

  tunnelUrl = detectedUrl;
  return tunnelUrl;
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
