/**
 * Lazy wrapper around the shared Tailor flow renderer so the chat bundle only
 * pays for @xyflow/react + tree-sitter when a workflow script is previewed.
 */

import { lazy, Suspense } from "react";
import "@xyflow/react/dist/style.css";

const TailorFlow = lazy(() =>
  import("@aprovan/registry-ui/tailor").then((m) => ({ default: m.TailorFlow })),
);

/**
 * Workflow scripts render as a flow instead of compiling as widgets. A file
 * is a workflow when it lives under a workflows/ directory (any extension —
 * entrypoints are often named main.tsx), or when its content is a bare
 * script body: widgets always `export` something, workflow scripts never do,
 * and feeding a bare script (top-level await/return) to the widget compiler
 * is a guaranteed build error.
 */
export function isWorkflowScript(path: string | undefined, code?: string): boolean {
  if (path && /(^|\/)workflows\//.test(path)) return true;
  return Boolean(code) && !/^\s*export\b/m.test(code ?? "");
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
