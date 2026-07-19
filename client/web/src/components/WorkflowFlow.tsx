/**
 * Lazy wrapper around the shared Tailor flow renderer so the chat bundle only
 * pays for @xyflow/react + tree-sitter when a workflow script is previewed.
 */

import { lazy, Suspense } from "react";
import "@xyflow/react/dist/style.css";

const TailorFlow = lazy(() =>
  import("@aprovan/registry-ui/tailor").then((m) => ({ default: m.TailorFlow })),
);

/** Workflow scripts: plain (non-JSX) js/ts under a workflows/ directory. */
export function isWorkflowScript(path: string | undefined): boolean {
  if (!path) return false;
  if (!/(^|\/)workflows\//.test(path)) return false;
  return /\.(js|ts|mjs)$/.test(path) && !/\.(jsx|tsx)$/.test(path);
}

export function WorkflowFlow({ source }: { source: string }) {
  return (
    <Suspense
      fallback={
        <div className="p-3 text-sm text-muted-foreground">Loading flow renderer…</div>
      }
    >
      <TailorFlow source={source} />
    </Suspense>
  );
}
