/**
 * Low-key LLM provider + model controls for the chat composer.
 *
 * A small provider mark + name opens a popover listing every chat provider
 * from the gateway's `/llm/providers`: connected ones are selectable (dot
 * indicator), unconnected ones deep-link to the registry credentials page.
 * Next to it, a model popover lists the provider's models (gateway
 * `/llm/:provider/models`) with the provider default marked.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import claudeSvg from "@lobehub/icons-static-svg/icons/claude.svg?raw";
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini.svg?raw";
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import { Check, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { credentialsUrl } from "@/lib/registry";
import type { LlmProviderInfo } from "@/lib/llm";

export interface ChatProvider {
  id: string;
  label: string;
}

/** Static fallback when the gateway's /llm/providers is unreachable. */
export const CHAT_PROVIDERS: readonly ChatProvider[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "synthetic.new", label: "Synthetic.new" },
] as const;

// Mono marks (fill: currentColor) so they follow the theme's foreground.
const ICON_SVGS: Record<string, string> = {
  openai: openaiSvg,
  anthropic: claudeSvg,
  gemini: geminiSvg,
};

function ProviderMark({ id, className = "h-4 w-4" }: { id: string; className?: string }) {
  const svg = ICON_SVGS[id];
  if (!svg) {
    // Providers without a brand mark (e.g. synthetic.new) get a monogram.
    // Glyph styling is fixed (not part of the size className) so the box
    // never stretches with the letter.
    return (
      <span
        className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-sm bg-foreground/80 text-[0.6rem] font-semibold leading-none text-background ${className}`}
      >
        {id.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Close the popover on any pointer press outside `ref`. */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

function Popover({
  open,
  onClose,
  trigger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-56 rounded-md border bg-card p-1 shadow-md">
          {children}
        </div>
      )}
    </div>
  );
}

const pillClass =
  "flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground";

/** Human-sized model label ("hf:zai-org/GLM-5.2" → "GLM-5.2"). */
function shortModelName(model: string): string {
  const tail = model.split("/").pop() ?? model;
  return tail.length > 32 ? `${tail.slice(0, 30)}…` : tail;
}

export function ProviderModelControls({
  providers,
  active,
  onSelectProvider,
  model,
  onSelectModel,
  loadModels,
}: {
  /** Gateway provider list; null while loading (fall back to static list). */
  providers: LlmProviderInfo[] | null;
  active: string;
  onSelectProvider: (id: string) => void;
  /** Selected model for the active provider ("" = provider default). */
  model: string;
  onSelectModel: (model: string) => void;
  /** Fetch the model ids for a connected provider. */
  loadModels: (providerId: string) => Promise<string[]>;
}) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState(false);
  const modelsFor = useRef<string | null>(null);

  const list: LlmProviderInfo[] =
    providers ??
    CHAT_PROVIDERS.map((provider) => ({
      ...provider,
      defaultModel: "",
      connected: true,
    }));
  const activeInfo = list.find((provider) => provider.id === active);
  const activeConnected = activeInfo?.connected ?? true;
  const activeModelLabel = model || activeInfo?.defaultModel || "default";

  // Model list is fetched lazily on first open, cached per provider.
  const openModels = useCallback(() => {
    setModelOpen((open) => !open);
    if (modelsFor.current !== active) {
      modelsFor.current = active;
      setModels(null);
      setModelsError(false);
      loadModels(active).then(setModels, () => setModelsError(true));
    }
  }, [active, loadModels]);

  return (
    <div className="flex items-center gap-1.5">
      <Popover
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        trigger={
          <button
            type="button"
            className={pillClass}
            onClick={() => setProviderOpen((open) => !open)}
            title={
              activeConnected
                ? `${activeInfo?.label ?? active} — connected`
                : `${activeInfo?.label ?? active} — no credential`
            }
          >
            <ProviderMark className="h-3.5 w-3.5" id={active} />
            <span className="font-medium">{activeInfo?.label ?? active}</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${activeConnected ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        }
      >
        {list.map((provider) => {
          const isActive = provider.id === active;
          if (!provider.connected) {
            return (
              <a
                key={provider.id}
                href={credentialsUrl(provider.id)}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                title={`${provider.label} is not connected — set up a credential in the registry`}
              >
                <ProviderMark className="h-3.5 w-3.5 shrink-0 opacity-60" id={provider.id} />
                <span className="flex-1 truncate text-left">{provider.label}</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.65rem] uppercase tracking-wide">
                  add key
                  <ExternalLink className="h-3 w-3" />
                </span>
              </a>
            );
          }
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => {
                onSelectProvider(provider.id);
                setProviderOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-muted ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <ProviderMark className="h-3.5 w-3.5 shrink-0" id={provider.id} />
              <span className="flex-1 truncate text-left">{provider.label}</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              {isActive && <Check className="h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </Popover>

      {activeConnected && (
        <Popover
          open={modelOpen}
          onClose={() => setModelOpen(false)}
          trigger={
            <button
              type="button"
              className={pillClass}
              onClick={openModels}
              title={`Model: ${activeModelLabel}`}
            >
              <span className="max-w-40 truncate">{shortModelName(activeModelLabel)}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          }
        >
          <div className="max-h-64 overflow-y-auto">
            {models === null && !modelsError && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading models…
              </div>
            )}
            {modelsError && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Couldn't load models — using the provider default.
              </div>
            )}
            {(models ?? []).map((id) => {
              const isDefault = id === activeInfo?.defaultModel;
              const isSelected = model ? id === model : isDefault;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onSelectModel(isDefault ? "" : id);
                    setModelOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-muted ${
                    isSelected ? "text-foreground" : "text-muted-foreground"
                  }`}
                  title={id}
                >
                  <span className="flex-1 truncate text-left">{shortModelName(id)}</span>
                  {isDefault && (
                    <span className="text-[0.65rem] uppercase tracking-wide opacity-60">default</span>
                  )}
                  {isSelected && <Check className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </div>
  );
}
