/**
 * @aprovan/patchwork-image-ink
 *
 * Ink terminal UI image for CLI widgets.
 * Provides React components for building terminal interfaces.
 */

export { setup, cleanup } from './setup.js';
export type { SetupOptions, InkEnvironment } from './setup.js';

// Runner - mounting/execution for terminal widgets
export {
  run,
  runOnce,
  evaluateWidget,
  renderComponent,
  getGlobals,
} from './runner.js';
export type {
  RunnerOptions,
  RunnerInstance,
  CompiledWidget,
  GlobalInjection,
} from './runner.js';

// Re-export Ink components for convenience
export {
  render,
  Box,
  Text,
  Static,
  Transform,
  Newline,
  Spacer,
  useInput,
  useApp,
  useFocus,
  useFocusManager,
  useStdin,
  useStdout,
  useStderr,
} from 'ink';

// Re-export React for widget authors
export { default as React } from 'react';

// Re-export chalk for styling
export { default as chalk } from 'chalk';
