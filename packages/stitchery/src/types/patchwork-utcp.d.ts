declare module "@aprovan/patchwork-utcp" {
  export function createUtcpBackend(
    config: Record<string, unknown>,
    cwd?: string,
  ): Promise<{
    backend: {
      call: (
        namespace: string,
        procedure: string,
        args: unknown[],
      ) => Promise<unknown>;
    };
    toolInfos: Array<{
      name: string;
      namespace: string;
      procedure: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }>;
}
