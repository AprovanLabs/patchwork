/**
 * Header services menu: what the current workspace's widgets can call.
 *
 * Three layers, one dialog:
 *  - Native tool groups (VFS, Key value, Events, Registry meta) — always
 *    available, grouped by type.
 *  - Registry providers — connected ones (a credential exists, so their tools
 *    ride the proxy) expand to their tool list and deep-link back to the
 *    registry catalog page; unconnected catalog providers offer a one-click
 *    "connect" into the registry credentials form.
 *  - Meta tools (registry.providers / registry.search) let widgets discover
 *    UTDK SDK operations at runtime; they appear under Native → Registry.
 */

import {
  BookOpen,
  ChevronRight,
  Database,
  ExternalLink,
  FolderTree,
  LayoutGrid,
  Plug,
  Plus,
  Radio,
  Server,
  Webhook,
  Workflow,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  credentialsUrl,
  fetchCatalogProviders,
  providerUrl,
  registryUrl,
  type CatalogProviderSummary,
} from "@/lib/registry";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ServiceInfo } from "@aprovan/patchwork-editor";

/** Core gateway namespaces get a friendly type label + mark. */
const NATIVE_GROUPS: Record<
  string,
  { label: string; blurb: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  vfs: { label: "VFS", blurb: "Workspace files", Icon: FolderTree },
  keyvalue: { label: "Key value", blurb: "Workspace-scoped KV store", Icon: Database },
  events: { label: "Events", blurb: "Emit + poll event channels", Icon: Radio },
  registry: {
    label: "Registry",
    blurb: "Look up available SDKs and operations",
    Icon: BookOpen,
  },
  workflows: {
    label: "Workflows",
    blurb: "Register + run workspace workflows",
    Icon: Workflow,
  },
  apps: {
    label: "Apps",
    blurb: "Publish + manage workspace apps",
    Icon: LayoutGrid,
  },
  webhooks: {
    label: "Webhooks",
    blurb: "Register provider webhooks that trigger workflows",
    Icon: Webhook,
  },
  interfaces: {
    label: "Interfaces",
    blurb: "Bind generic interfaces (llm, sql) to providers",
    Icon: Plug,
  },
};

function ToolRow({ tool }: { tool: ServiceInfo }) {
  return (
    <details className="group/tool">
      <summary className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/tool:rotate-90" />
        <code className="font-mono shrink-0">{tool.procedure}</code>
        <span className="truncate opacity-70">{tool.description}</span>
      </summary>
      {tool.parameters ? (
        <pre className="mx-2 my-1 max-h-48 overflow-auto rounded border bg-muted/30 p-2 text-[0.65rem] font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(tool.parameters, null, 2)}
        </pre>
      ) : (
        <p className="mx-2 my-1 text-[0.65rem] text-muted-foreground">
          No parameter schema published.
        </p>
      )}
    </details>
  );
}

function GroupSection({
  icon,
  title,
  subtitle,
  badge,
  action,
  tools,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  tools: ServiceInfo[];
}) {
  return (
    <details className="group rounded-md border">
      <summary className="flex items-center gap-2.5 px-3 py-2 cursor-pointer rounded-md hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="hidden sm:inline truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {badge}
          {action}
        </span>
      </summary>
      <div className="border-t px-2 py-1.5 space-y-0.5">
        {tools.length > 0 ? (
          tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No tool details available.
          </p>
        )}
      </div>
    </details>
  );
}

function ProviderMark({
  provider,
  catalog,
}: {
  provider: string;
  catalog: Map<string, CatalogProviderSummary>;
}) {
  const icon = catalog.get(provider)?.icon;
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        className="h-4 w-4 rounded-sm object-contain"
        loading="lazy"
      />
    );
  }
  return (
    <span className="inline-flex h-4 w-4 shrink-0 select-none items-center justify-center overflow-hidden rounded-sm bg-foreground/80 text-[0.6rem] font-semibold leading-none text-background">
      {provider.charAt(0).toUpperCase()}
    </span>
  );
}

export function ServicesMenu({ services }: { services: ServiceInfo[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<CatalogProviderSummary[] | null>(null);

  useEffect(() => {
    if (!open || catalog !== null) return;
    void fetchCatalogProviders().then((providers) => setCatalog(providers ?? []));
  }, [open, catalog]);

  const catalogById = useMemo(
    () => new Map((catalog ?? []).map((p) => [p.id, p])),
    [catalog],
  );

  const grouped = useMemo(() => {
    const byNamespace = new Map<string, ServiceInfo[]>();
    for (const service of services) {
      const list = byNamespace.get(service.namespace) ?? [];
      list.push(service);
      byNamespace.set(service.namespace, list);
    }
    return byNamespace;
  }, [services]);

  const nativeNamespaces = [...grouped.keys()].filter((ns) => ns in NATIVE_GROUPS);
  const connectedProviders = [...grouped.keys()]
    .filter((ns) => !(ns in NATIVE_GROUPS))
    .sort();
  const connectedSet = new Set(connectedProviders);
  const query = filter.trim().toLowerCase();
  const unconnected = (catalog ?? [])
    .filter((p) => !connectedSet.has(p.id))
    .filter(
      (p) =>
        !query ||
        p.id.toLowerCase().includes(query) ||
        p.title.toLowerCase().includes(query),
    );

  const toolCount = services.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        title="Available services and tools"
      >
        <Server className="h-4 w-4 text-muted-foreground" />
        <Badge variant="outline" className="text-xs font-normal">
          {toolCount > 0
            ? `${toolCount} tool${toolCount !== 1 ? "s" : ""}`
            : "services"}
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Services</DialogTitle>
          <DialogClose onClose={() => setOpen(false)} />
        </DialogHeader>
        <DialogContent className="space-y-4">
          {/* Native tool groups */}
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Native
            </h3>
            {nativeNamespaces.length > 0 ? (
              nativeNamespaces.map((ns) => {
                const meta = NATIVE_GROUPS[ns];
                const tools = grouped.get(ns) ?? [];
                return (
                  <GroupSection
                    key={ns}
                    icon={<meta.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    title={meta.label}
                    subtitle={meta.blurb}
                    badge={
                      <Badge variant="secondary" className="text-[0.65rem]">
                        {tools.length}
                      </Badge>
                    }
                    tools={tools}
                  />
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground">
                Native tools load once the gateway is reachable.
              </p>
            )}
          </section>

          {/* Connected registry providers */}
          <section className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Providers
              </h3>
              <a
                href={credentialsUrl()}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                add credential
              </a>
            </div>
            {connectedProviders.length > 0 ? (
              connectedProviders.map((provider) => {
                const tools = grouped.get(provider) ?? [];
                const info = catalogById.get(provider);
                return (
                  <GroupSection
                    key={provider}
                    icon={<ProviderMark provider={provider} catalog={catalogById} />}
                    title={info?.title ?? provider}
                    subtitle={info?.description ?? undefined}
                    badge={
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <Badge variant="secondary" className="text-[0.65rem]">
                          {tools.length}
                        </Badge>
                      </>
                    }
                    action={
                      <a
                        href={providerUrl(provider)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                        title="Open in registry"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    }
                    tools={tools}
                  />
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground">
                No providers connected yet — add a credential to bring its
                tools into this workspace.
              </p>
            )}
          </section>

          {/* The rest of the catalog: one click from connected */}
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available in the registry
            </h3>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter providers…"
              className="h-8"
            />
            {catalog === null ? (
              <p className="text-xs text-muted-foreground">Loading catalog…</p>
            ) : unconnected.length > 0 ? (
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {unconnected.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    <ProviderMark provider={provider.id} catalog={catalogById} />
                    <a
                      href={providerUrl(provider.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium text-foreground/80 hover:underline"
                    >
                      {provider.title}
                    </a>
                    <span className="hidden sm:inline truncate opacity-70">
                      {provider.description}
                    </span>
                    <a
                      href={credentialsUrl(provider.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.65rem] uppercase tracking-wide hover:text-foreground"
                    >
                      connect
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {query ? "No providers match the filter." : "Catalog unavailable."}
              </p>
            )}
            <a
              href={registryUrl("/providers/")}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Wrench className="h-3 w-3" />
              Browse the full registry
              <ExternalLink className="h-3 w-3" />
            </a>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
