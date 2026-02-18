/**
 * @aprovan/patchwork-image-ink
 *
 * Setup function for the Ink terminal UI image.
 * Handles terminal environment configuration for CLI widgets.
 */

import type { WriteStream } from 'node:tty';

export interface SetupOptions {
  /** Output stream (default: process.stdout) */
  stdout?: WriteStream;
  /** Input stream (default: process.stdin) */
  stdin?: NodeJS.ReadStream;
  /** Enable color support detection override */
  colorMode?: 'detect' | 'ansi' | 'ansi256' | 'truecolor' | 'none';
  /** Enable debug mode (default: false) */
  debug?: boolean;
}

export interface InkEnvironment {
  stdout: WriteStream;
  stdin: NodeJS.ReadStream;
  colorSupport: 'none' | 'ansi' | 'ansi256' | 'truecolor';
  isInteractive: boolean;
  columns: number;
  rows: number;
}

/**
 * Detect terminal color support
 */
function detectColorSupport(
  stdout: WriteStream,
): 'none' | 'ansi' | 'ansi256' | 'truecolor' {
  // Check for NO_COLOR environment variable
  if (process.env['NO_COLOR'] !== undefined) {
    return 'none';
  }

  // Check for FORCE_COLOR
  const forceColor = process.env['FORCE_COLOR'];
  if (forceColor !== undefined) {
    if (forceColor === '0') return 'none';
    if (forceColor === '1') return 'ansi';
    if (forceColor === '2') return 'ansi256';
    if (forceColor === '3') return 'truecolor';
  }

  // Check COLORTERM for true color
  if (
    process.env['COLORTERM'] === 'truecolor' ||
    process.env['COLORTERM'] === '24bit'
  ) {
    return 'truecolor';
  }

  // Check terminal capabilities
  if (!stdout.isTTY) {
    return 'none';
  }

  // Check TERM for 256 color support
  const term = process.env['TERM'] || '';
  if (term.includes('256color') || term.includes('256')) {
    return 'ansi256';
  }

  // Default to basic ANSI if TTY
  return 'ansi';
}

/**
 * Setup the Ink terminal UI image runtime environment
 *
 * @param options - Optional configuration
 * @returns Environment configuration for Ink
 */
export function setup(options: SetupOptions = {}): InkEnvironment {
  const {
    stdout = process.stdout as WriteStream,
    stdin = process.stdin,
    colorMode = 'detect',
    debug = false,
  } = options;

  // Detect or use specified color mode
  let colorSupport: 'none' | 'ansi' | 'ansi256' | 'truecolor';
  if (colorMode === 'detect') {
    colorSupport = detectColorSupport(stdout);
  } else {
    colorSupport = colorMode;
  }

  // Get terminal dimensions
  const columns = stdout.columns || 80;
  const rows = stdout.rows || 24;

  // Check if interactive
  const isInteractive = stdin.isTTY ?? false;

  if (debug) {
    console.error(`[patchwork-ink] Color support: ${colorSupport}`);
    console.error(`[patchwork-ink] Terminal size: ${columns}x${rows}`);
    console.error(`[patchwork-ink] Interactive: ${isInteractive}`);
  }

  return {
    stdout,
    stdin,
    colorSupport,
    isInteractive,
    columns,
    rows,
  };
}

/**
 * Cleanup - no-op for CLI but provided for API consistency
 */
export function cleanup(): void {
  // No cleanup needed for terminal
}
