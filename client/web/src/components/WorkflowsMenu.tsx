/**
 * Header workflows menu: the shared WorkflowsPanel (same component the
 * registry renders) in a dialog, wired to the gateway's `workflows` tool
 * namespace through the chat app's authenticated fetch.
 */

import { Workflow } from "lucide-react";
import { useCallback, useState } from "react";
import { WorkflowsPanel } from "@aprovan/registry-ui/workflows-panel";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GATEWAY_BASE } from "@/lib/gateway";
import { gatewayFetch } from "@/lib/gateway-fetch";

async function invokeWorkflows(
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await gatewayFetch(`${GATEWAY_BASE}/tools/workflows/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const body = (await res.json()) as { data?: unknown; error?: string };
  if (!res.ok) throw new Error(body.error ?? `workflows.${operation} failed (${res.status})`);
  return body.data;
}

export function WorkflowsMenu({
  onOpenScript,
}: {
  onOpenScript?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleOpenScript = useCallback(
    (path: string) => {
      setOpen(false);
      onOpenScript?.(path);
    },
    [onOpenScript],
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Workspace workflows"
      >
        <Workflow className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Workflows</DialogTitle>
          <DialogClose onClose={() => setOpen(false)} />
        </DialogHeader>
        <DialogContent>
          <WorkflowsPanel invoke={invokeWorkflows} onOpenScript={handleOpenScript} />
        </DialogContent>
      </Dialog>
    </>
  );
}
