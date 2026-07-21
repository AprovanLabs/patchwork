/**
 * Workspace file preview via the shared @aprovan/registry-ui renderer registry.
 * Importing tailor registers the workflow-script renderer (TailorFlow); JSON and
 * other built-in types register from renderers. Returns null when nothing
 * matches so CodePreview can fall through to widget/markdown defaults.
 */

import {
  RenderedView,
  resolveRenderer,
  type RenderInput,
} from "@aprovan/registry-ui/renderers";
import "@aprovan/registry-ui/tailor";
import "@xyflow/react/dist/style.css";

export function WorkspaceFilePreview({
  code,
  filePath,
}: {
  code: string;
  filePath?: string;
}) {
  const input: RenderInput = { path: filePath, content: code };
  if (!resolveRenderer(input)) return null;
  return <RenderedView input={input} />;
}
