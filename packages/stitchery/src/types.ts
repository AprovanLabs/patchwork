export interface ServerConfig {
  port: number;
  host: string;
  copilotProxyUrl: string;
  localPackages: Record<string, string>;
  mcpServers: McpServerConfig[];
  /** Directory for virtual file system storage */
  vfsDir?: string;
  /** Use file paths from code blocks instead of UUIDs */
  vfsUsePaths?: boolean;
  /** Directory for SQLite databases and persistent data */
  dataDir?: string;
  /** Directory containing SKILL.md files */
  skillsDir?: string;
  /** Enable unified event system */
  enableEvents?: boolean;
  /** Enable orchestrator for event-driven skills */
  enableOrchestrator?: boolean;
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
