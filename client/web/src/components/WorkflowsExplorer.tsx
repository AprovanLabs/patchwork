/**
 * WorkflowsExplorer — first-party workflows section for the chat sidebar,
 * sitting under the file tree like a second explorer. Lists the workspace's
 * registered workflows with their trigger kinds and last-run state; a row
 * opens the script (Tailor flow preview tab), the play button runs it, and
 * the trace button opens the full shared panel.
 */

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ListTree,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GATEWAY_BASE } from "@/lib/gateway";
import { gatewayFetch } from "@/lib/gateway-fetch";

export interface WorkflowEntry {
  name: string;
  description?: string;
  scriptPath: string;
  triggers: { manual?: boolean; cron?: string; webhook?: boolean; events?: string[] };
}

interface RunSummary {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
}

function invokeNamespaceTool(namespace: string) {
  return async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
    const res = await gatewayFetch(`${GATEWAY_BASE}/tools/${namespace}/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const body = (await res.json()) as { data?: unknown; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${namespace}.${operation} failed (${res.status})`);
    return body.data;
  };
}

export const invokeWorkflowsTool = invokeNamespaceTool("workflows");
export const invokeAppsTool = invokeNamespaceTool("apps");

function TriggerIcons({ workflow }: { workflow: WorkflowEntry }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground/70">
      {workflow.triggers.cron && (
        <Clock className="h-3 w-3" aria-label="Cron" />
      )}
      {workflow.triggers.webhook && <Webhook className="h-3 w-3" aria-label="Webhook" />}
      {workflow.triggers.events?.length ? (
        <Radio className="h-3 w-3" aria-label="Events" />
      ) : null}
    </span>
  );
}

function LastRunDot({ run }: { run: RunSummary | undefined }) {
  if (!run) return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />;
  if (run.status === "running")
    return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />;
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        run.status === "succeeded" ? "bg-emerald-500" : "bg-red-500"
      }`}
    />
  );
}

export function WorkflowsExplorer({
  onOpenScript,
  onOpenPanel,
}: {
  /** Open the workflow's script in a preview tab (Tailor flow). */
  onOpenScript: (path: string) => void;
  /** Open the full workflows panel (runs + traces). */
  onOpenPanel: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowEntry[] | null>(null);
  const [lastRuns, setLastRuns] = useState<Record<string, RunSummary>>({});
  const [loading, setLoading] = useState(false);
  const [runningName, setRunningName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invokeWorkflowsTool("list", {})) as {
        workflows: WorkflowEntry[];
      };
      setWorkflows(result.workflows);
      // Last-run state per workflow, best-effort in parallel.
      const entries = await Promise.all(
        result.workflows.map(async (workflow) => {
          try {
            const runs = (await invokeWorkflowsTool("runs", {
              name: workflow.name,
              limit: 1,
            })) as { runs: RunSummary[] };
            return [workflow.name, runs.runs[0]] as const;
          } catch {
            return [workflow.name, undefined] as const;
          }
        }),
      );
      setLastRuns(
        Object.fromEntries(entries.filter(([, run]) => run)) as Record<string, RunSummary>,
      );
    } catch (err) {
      // Offline / signed-out: keep the section quiet, not noisy.
      setWorkflows([]);
      setError(err instanceof Error ? err.message : "Workflows unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runNow = useCallback(
    async (name: string) => {
      setRunningName(name);
      try {
        const run = (await invokeWorkflowsTool("run", { name })) as RunSummary;
        setLastRuns((prev) => ({ ...prev, [name]: run }));
      } catch {
        // The panel shows details; the dot just goes red on next refresh.
      } finally {
        setRunningName(null);
      }
    },
    [],
  );

  return (
    <div className="border-t">
      <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Workflows</span>
        <button
          onClick={onOpenPanel}
          className="ml-auto p-1 rounded hover:bg-muted"
          title="Open workflow runs and traces"
        >
          <ListTree className="h-3 w-3" />
        </button>
        <button
          onClick={() => void refresh()}
          className="p-1 rounded hover:bg-muted"
          title="Refresh workflows"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {workflows === null ? (
        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : workflows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {error ? "Workflows load once the gateway is reachable." : "No workflows registered yet."}
        </p>
      ) : (
        <div className="py-1">
          {workflows.map((workflow) => {
            const running = runningName === workflow.name;
            const lastRun = lastRuns[workflow.name];
            return (
              <div
                key={workflow.name}
                className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
              >
                <LastRunDot run={running ? { id: "", status: "running", startedAt: "" } : lastRun} />
                <button
                  onClick={() => onOpenScript(workflow.scriptPath)}
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  title={workflow.description ?? workflow.scriptPath}
                >
                  {workflow.name}
                </button>
                <TriggerIcons workflow={workflow} />
                <button
                  onClick={() => void runNow(workflow.name)}
                  disabled={running}
                  className="p-1 rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title="Run now"
                >
                  {running ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </button>
                {lastRun?.status === "failed" && !running && (
                  <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
                )}
                {lastRun?.status === "succeeded" && !running && (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 opacity-0 group-hover:opacity-100" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
