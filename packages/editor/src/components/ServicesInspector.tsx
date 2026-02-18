import { useState } from 'react';
import { ChevronDown, Server } from 'lucide-react';

export interface ServiceInfo {
  name: string;
  namespace: string;
  procedure: string;
  description: string;
  parameters: {
    jsonSchema: Record<string, unknown>;
  };
}

interface ServicesInspectorProps {
  namespaces: string[];
  services?: ServiceInfo[];
  /** Custom badge component for rendering the service count */
  BadgeComponent?: React.ComponentType<{ children: React.ReactNode; variant?: string; className?: string }>;
  /** Custom collapsible components */
  CollapsibleComponent?: React.ComponentType<{ children: React.ReactNode; defaultOpen?: boolean; className?: string }>;
  CollapsibleTriggerComponent?: React.ComponentType<{ children: React.ReactNode; className?: string }>;
  CollapsibleContentComponent?: React.ComponentType<{ children: React.ReactNode }>;
  /** Custom dialog components */
  DialogComponent?: React.ComponentType<{ children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }>;
  DialogHeaderComponent?: React.ComponentType<{ children: React.ReactNode }>;
  DialogContentComponent?: React.ComponentType<{ children: React.ReactNode }>;
  DialogCloseComponent?: React.ComponentType<{ onClose?: () => void }>;
}

// Fallback components for when custom UI is not provided
function DefaultBadge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>
      {children}
    </span>
  );
}

function DefaultDialog({ children, open, onOpenChange }: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => onOpenChange?.(false)}>
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 bg-background p-6 shadow-lg rounded-lg" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ServicesInspector({ 
  namespaces, 
  services = [],
  BadgeComponent = DefaultBadge,
  DialogComponent = DefaultDialog,
}: ServicesInspectorProps) {
  const [open, setOpen] = useState(false);

  if (namespaces.length === 0) return null;

  const groupedServices = services.reduce<Record<string, ServiceInfo[]>>((acc, svc) => {
    (acc[svc.namespace] ??= []).push(svc);
    return acc;
  }, {});

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <Server className="h-4 w-4 text-muted-foreground" />
        <BadgeComponent className="text-xs">
          {namespaces.length} service{namespaces.length !== 1 ? 's' : ''}
        </BadgeComponent>
      </button>

      <DialogComponent open={open} onOpenChange={setOpen}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Available Services</h2>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">×</button>
        </div>
        <div className="space-y-3 max-h-96 overflow-auto">
          {namespaces.map((ns) => (
            <details key={ns} open={namespaces.length === 1}>
              <summary className="flex items-center gap-2 w-full p-2 rounded bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{ns}</span>
                {groupedServices[ns] && (
                  <BadgeComponent className="ml-auto text-xs">
                    {groupedServices[ns].length} tool{groupedServices[ns].length !== 1 ? 's' : ''}
                  </BadgeComponent>
                )}
              </summary>
              <div className="ml-6 mt-2 space-y-2">
                {groupedServices[ns]?.map((svc) => (
                  <details key={svc.name}>
                    <summary className="flex items-center gap-2 w-full text-left text-sm hover:text-foreground text-muted-foreground transition-colors cursor-pointer">
                      <ChevronDown className="h-3 w-3" />
                      <code className="font-mono text-xs">{svc.procedure}</code>
                      <span className="truncate text-xs opacity-70">{svc.description}</span>
                    </summary>
                    <div className="ml-5 mt-1 p-2 rounded border bg-muted/30 overflow-auto max-h-48">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0">
                        {JSON.stringify(svc.parameters.jsonSchema, null, 2)}
                      </pre>
                    </div>
                  </details>
                )) ?? (
                  <p className="text-xs text-muted-foreground">No tool details available</p>
                )}
              </div>
            </details>
          ))}
        </div>
      </DialogComponent>
    </>
  );
}
