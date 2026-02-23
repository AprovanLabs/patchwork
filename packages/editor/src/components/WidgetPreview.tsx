import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { Compiler, Manifest, MountedWidget } from '@aprovan/patchwork-compiler';

export interface WidgetPreviewProps {
  code: string;
  compiler: Compiler | null;
  services?: string[];
  enabled?: boolean;
}

function createManifest(services?: string[]): Manifest {
  return {
    name: 'preview',
    version: '1.0.0',
    platform: 'browser',
    image: '@aprovan/patchwork-image-shadcn',
    services,
  };
}

export function WidgetPreview({
  code,
  compiler,
  services,
  enabled = true,
}: WidgetPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedWidget | null>(null);

  useEffect(() => {
    if (!enabled || !compiler || !containerRef.current) return;

    let cancelled = false;

    const compileAndMount = async () => {
      setLoading(true);
      setError(null);

      try {
        if (mountedRef.current) {
          compiler.unmount(mountedRef.current);
          mountedRef.current = null;
        }

        const widget = await compiler.compile(code, createManifest(services), {
          typescript: true,
        });

        if (cancelled || !containerRef.current) return;

        const mounted = await compiler.mount(widget, {
          target: containerRef.current,
          mode: 'embedded',
        });

        mountedRef.current = mounted;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render preview');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void compileAndMount();

    return () => {
      cancelled = true;
      if (mountedRef.current && compiler) {
        compiler.unmount(mountedRef.current);
        mountedRef.current = null;
      }
    };
  }, [code, compiler, enabled, services]);

  return (
    <>
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2 p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {loading && (
        <div className="p-3 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Rendering preview...</span>
        </div>
      )}
      {!compiler && enabled && !loading && !error && (
        <div className="p-3 text-sm text-muted-foreground">Compiler not initialized</div>
      )}
      <div ref={containerRef} className="w-full" />
    </>
  );
}
