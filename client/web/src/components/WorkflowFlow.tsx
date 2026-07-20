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
 * is a workflow when it is plain js/ts under a workflows/ directory, or when
 * its content is a bare script body that awaits namespace tool calls —
 * widgets always `export` something (and use JSX), workflow scripts never
 * do. Extension and shape checks are strict so data files (.json, .md)
 * never fall into the flow renderer.
 */
export function isWorkflowScript(path: string | undefined, code?: string): boolean {
  if (path && /(^|\/)workflows\/[^/]+\.(js|ts)$/.test(path)) return true;
  if (path && !/\.(js|ts)$/.test(path)) return false;
  if (!code) return false;
  if (/^\s*(import\s|export\s)/m.test(code)) return false;
  if (/<[A-Z][A-Za-z]*[\s/>]/.test(code)) return false;
  return /\bawait\s+[a-zA-Z_$][\w$]*\.[\w$.]+\(/.test(code);
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
