import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });

  return <FileTree model={model} className="h-96 rounded-lg border" />;
}
