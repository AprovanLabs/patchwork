/**
 * Header workflows menu: the shared WorkflowsPanel (same component the
 * registry renders) in a dialog, wired to the gateway's `workflows` tool
 * namespace through the chat app's authenticated fetch. Open state can be
 * controlled by the host so other surfaces (the sidebar explorer) can open
 * the same panel.
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
import { invokeAppsTool, invokeWorkflowsTool } from "@/components/WorkflowsExplorer";

export function WorkflowsMenu({
  onOpenScript,
  open: controlledOpen,
  onOpenChange,
}: {
  onOpenScript?: (path: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const handleOpenScript = useCallback(
    (path: string) => {
      setOpen(false);
      onOpenScript?.(path);
    },
    [onOpenScript, setOpen],
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
          <WorkflowsPanel
            invoke={invokeWorkflowsTool}
            invokeApps={invokeAppsTool}
            onOpenScript={handleOpenScript}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
