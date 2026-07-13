import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const gatewayBase = (
  (import.meta.env["VITE_MCP_URL"] as string | undefined) ||
  (import.meta.env.DEV
    ? "/gateway/mcp"
    : "https://aprovan.com/api/gateway/mcp")
).replace(/\/mcp\/?$/, "");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("patchwork:authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Workspace {
  workspaceId: string;
  name: string;
  plan: string;
  active: boolean;
}

interface WorkspaceSwitcherProps {
  onLoad?: (activeWorkspaceId: string | null) => void;
  onSwitch: (workspaceId: string) => void;
}

export default function WorkspaceSwitcher({ onLoad, onSwitch }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    void fetch(`${gatewayBase}/session`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: {
        workspaces: Array<{ id: string; name: string; role: string }>;
        activeWorkspaceId: string | null;
      }) => {
        setWorkspaces(
          (data.workspaces ?? []).map((workspace) => ({
            workspaceId: workspace.id,
            name: workspace.name,
            plan: workspace.role,
            active: workspace.id === data.activeWorkspaceId,
          })),
        );
        setActiveId(data.activeWorkspaceId);
        onLoadRef.current?.(data.activeWorkspaceId);
      })
      .catch(() => { onLoadRef.current?.(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const active = workspaces.find((w) => w.workspaceId === activeId) ?? workspaces[0];

  async function handleSelect(workspaceId: string) {
    if (workspaceId === activeId || switching) return;
    setOpen(false);
    setSwitching(true);
    try {
      await fetch(`${gatewayBase}/session/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ workspaceId }),
      });
      setActiveId(workspaceId);
      setWorkspaces((prev) =>
        prev.map((w) => ({ ...w, active: w.workspaceId === workspaceId })),
      );
      onSwitch(workspaceId);
    } catch {
      // silently ignore — the current workspace stays active
    } finally {
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  if (workspaces.length <= 1) {
    return (
      <span className="text-xs text-muted-foreground truncate max-w-[160px]">
        {active?.name ?? ""}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[160px]"
        title={active?.name}
      >
        {switching ? (
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        ) : null}
        <span className="truncate">{active?.name ?? ""}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-md border bg-popover shadow-md">
          {workspaces.map((w) => (
            <button
              key={w.workspaceId}
              onClick={() => void handleSelect(w.workspaceId)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors first:rounded-t-md last:rounded-b-md ${
                w.workspaceId === activeId
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <div className="truncate">{w.name}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                {w.plan}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
