/**
 * Default preview for .json workspace files: a scrollable, collapsible tree
 * (native <details>, no state) instead of a flat code block.
 */

function JsonNode({
  name,
  value,
  depth,
}: {
  name?: string;
  value: unknown;
  depth: number;
}) {
  const label = name !== undefined && (
    <span className="text-sky-700 dark:text-sky-400">{name}: </span>
  );
  if (value === null || typeof value !== "object") {
    const text = typeof value === "string" ? JSON.stringify(value) : String(value);
    const tone =
      typeof value === "string"
        ? "text-emerald-700 dark:text-emerald-400"
        : typeof value === "number"
          ? "text-amber-700 dark:text-amber-400"
          : "text-purple-700 dark:text-purple-400";
    return (
      <div className="pl-4">
        {label}
        <span className={`${tone} break-all`}>{text}</span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const preview = Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`;
  if (entries.length === 0) {
    return (
      <div className="pl-4">
        {label}
        <span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>
      </div>
    );
  }
  return (
    <details className="pl-4" open={depth < 2}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block w-2 text-muted-foreground">›</span>
        {label}
        <span className="text-muted-foreground">{preview}</span>
      </summary>
      {entries.map(([key, item]) => (
        <JsonNode key={key} depth={depth + 1} name={key} value={item} />
      ))}
    </details>
  );
}

export function isJsonFile(path: string | undefined): boolean {
  return Boolean(path && /\.json$/.test(path));
}

export function JsonPreview({ code }: { code: string }) {
  let value: unknown;
  try {
    value = JSON.parse(code);
  } catch (err) {
    return (
      <div className="p-3 text-sm text-destructive">
        Invalid JSON: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }
  return (
    <div className="max-h-[28rem] overflow-auto p-2 pl-0 font-mono text-xs leading-relaxed">
      <JsonNode depth={0} value={value} />
    </div>
  );
}
