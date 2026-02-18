/**
 * UTCP service configuration
 * Used to register services via UTCP protocol
 */
export interface UtcpConfig {
  /** Working directory for UTCP operations */
  cwd?: string;
  /** Manual call templates (service definitions) */
  manual_call_templates?: Array<{
    name: string;
    call_template_type: string;
    url?: string;
    http_method?: string;
    [key: string]: unknown;
  }>;
  /** Additional UTCP options */
  [key: string]: unknown;
}

export interface ServerConfig {
  port: number;
  host: string;
  copilotProxyUrl: string;
  localPackages: Record<string, string>;
  mcpServers: McpServerConfig[];
  /** UTCP configuration for registering services */
  utcp?: UtcpConfig;
  /** Directory for virtual file system storage */
  vfsDir?: string;
  /** Use file paths from code blocks instead of UUIDs */
  vfsUsePaths?: boolean;
  verbose: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface ChatRequest {
  messages: UIMessage[];
  metadata?: {
    patchwork?: {
      compilers?: string[];
    };
  };
}

export interface EditRequest {
  code: string;
  prompt: string;
}

export interface UIMessage {
  role: string;
  content: string;
  parts?: Array<{ type: string; text: string }>;
}
