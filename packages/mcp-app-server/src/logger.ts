type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const CURRENT_LEVEL: LogLevel =
  (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[CURRENT_LEVEL];
}

function formatMessage(tag: string, ...args: unknown[]): unknown[] {
  return [`[${tag}]`, ...args];
}

// All logging goes to stderr to avoid interfering with MCP stdio protocol on stdout
export function debug(tag: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.error(...formatMessage(tag, ...args));
  }
}

export function log(tag: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.error(...formatMessage(tag, ...args));
  }
}

export function warn(tag: string, ...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.error(...formatMessage(tag, ...args));
  }
}

export function error(tag: string, ...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(...formatMessage(tag, ...args));
  }
}
