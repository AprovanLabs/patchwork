/**
 * @aprovan/patchwork-ink - Runner
 *
 * Provides the runtime mounting logic for Ink terminal widgets.
 * The image owns all ink/react dependencies and mounting code.
 */

import type { WriteStream } from 'node:tty';
import { render } from 'ink';
import React from 'react';

/**
 * Global injections for compiling widgets with this image
 *
 * These tell the compiler which imports to transform into global variable references.
 * The evaluateWidget function will provide these globals at runtime.
 */
export interface GlobalInjection {
  module: string;
  globalName: string;
}

export function getGlobals(): GlobalInjection[] {
  return [
    { module: 'react', globalName: '__REACT__' },
    { module: 'ink', globalName: '__INK__' },
  ];
}

export interface RunnerOptions {
  /** Service proxy for UTCP calls */
  proxy?: {
    call(
      namespace: string,
      procedure: string,
      args: unknown[],
    ): Promise<unknown>;
  };
  /** Initial props/inputs to pass to widget */
  inputs?: Record<string, unknown>;
  /** Output stream (default: process.stdout) */
  stdout?: WriteStream;
  /** Input stream (default: process.stdin) */
  stdin?: NodeJS.ReadStream;
  /** Exit on Ctrl+C (default: true) */
  exitOnCtrlC?: boolean;
}

export interface RunnerInstance {
  /** Unique mount ID */
  id: string;
  /** Unmount the widget */
  unmount: () => void;
  /** Wait until the widget exits */
  waitUntilExit: () => Promise<void>;
  /** Rerender with new props */
  rerender: (props: Record<string, unknown>) => void;
  /** Clear the terminal output */
  clear: () => void;
}

let mountCounter = 0;

function generateMountId(): string {
  return `patchwork-ink-${Date.now()}-${++mountCounter}`;
}

/**
 * Generate namespace globals that proxy calls to a service proxy
 *
 * Given services like ["git.branch", "git.status", "github.repos.get"],
 * generates globals with appropriate methods.
 */
function generateNamespaceGlobals(
  services: string[],
  proxy: RunnerOptions['proxy'],
): Record<string, unknown> {
  if (!proxy) return {};

  const namespaces: Record<string, Record<string, unknown>> = {};

  for (const service of services) {
    const parts = service.split('.');
    if (parts.length < 2) continue;

    const namespace = parts[0] as string;
    const procedurePath = parts.slice(1);

    if (!namespaces[namespace]) {
      namespaces[namespace] = {};
    }

    let current = namespaces[namespace] as Record<string, unknown>;
    for (let i = 0; i < procedurePath.length - 1; i++) {
      const key = procedurePath[i] as string;
      if (!current[key]) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    const finalKey = procedurePath[procedurePath.length - 1] as string;
    const fullProcedure = procedurePath.join('.');
    current[finalKey] = (...args: unknown[]) =>
      proxy.call(namespace, fullProcedure, args);
  }

  return namespaces;
}

/**
 * Extract unique namespace names from services array
 */
function extractNamespaces(services: string[]): string[] {
  const namespaces = new Set<string>();
  for (const service of services) {
    const parts = service.split('.');
    if (parts[0]) {
      namespaces.add(parts[0]);
    }
  }
  return Array.from(namespaces);
}

/**
 * Inject namespace globals into globalThis
 */
function injectNamespaceGlobals(namespaces: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(namespaces)) {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

/**
 * Remove namespace globals from globalThis
 */
function removeNamespaceGlobals(namespaceNames: string[]): void {
  for (const name of namespaceNames) {
    delete (globalThis as Record<string, unknown>)[name];
  }
}

export interface CompiledWidget {
  /** Compiled ESM code */
  code: string;
  /** Content hash for caching */
  hash: string;
  /** Original manifest */
  manifest: {
    name: string;
    services?: string[];
    [key: string]: unknown;
  };
}

/**
 * Run a compiled widget using Ink
 *
 * This is the main entry point for running terminal widgets.
 * The image owns all React/Ink dependencies.
 */
export async function run(
  widget: CompiledWidget,
  options: RunnerOptions = {},
): Promise<RunnerInstance> {
  const {
    proxy,
    inputs = {},
    stdout = process.stdout as WriteStream,
    stdin = process.stdin,
    exitOnCtrlC = true,
  } = options;
  const mountId = generateMountId();

  // Inject namespace globals for services
  const services = widget.manifest.services || [];
  const namespaceNames = extractNamespaces(services);
  const namespaces = generateNamespaceGlobals(services, proxy);
  injectNamespaceGlobals(namespaces);

  // Import the widget module from code
  const dataUri = `data:text/javascript;base64,${Buffer.from(
    widget.code,
  ).toString('base64')}`;

  let module: { default?: unknown };
  try {
    module = await import(/* webpackIgnore: true */ /* @vite-ignore */ dataUri);
  } catch {
    // Fallback: use Function-based loading
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (argName: string, code: string) => (
      exports: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    const exports: Record<string, unknown> = {};
    const fn = new AsyncFunction('exports', widget.code + '\nreturn exports;');
    module = await fn(exports);
  }

  const Component = module.default;
  if (!Component) {
    removeNamespaceGlobals(namespaceNames);
    throw new Error('Widget must export a default component');
  }

  if (typeof Component !== 'function') {
    removeNamespaceGlobals(namespaceNames);
    throw new Error('Widget default export must be a function/component');
  }

  // Render using Ink
  let currentInputs = { ...inputs };
  const element = React.createElement(
    Component as React.ComponentType,
    currentInputs,
  );
  const instance = render(element, {
    stdout,
    stdin,
    exitOnCtrlC,
  });

  return {
    id: mountId,
    unmount() {
      instance.unmount();
      removeNamespaceGlobals(namespaceNames);
    },
    waitUntilExit() {
      return instance.waitUntilExit();
    },
    rerender(newInputs: Record<string, unknown>) {
      currentInputs = { ...currentInputs, ...newInputs };
      const newElement = React.createElement(
        Component as React.ComponentType,
        currentInputs,
      );
      instance.rerender(newElement);
    },
    clear() {
      instance.clear();
    },
  };
}

/**
 * Run a widget once and wait for exit
 */
export async function runOnce(
  widget: CompiledWidget,
  options: RunnerOptions = {},
): Promise<void> {
  const instance = await run(widget, options);
  await instance.waitUntilExit();
  instance.unmount();
}

/**
 * Evaluate widget code and return the component
 *
 * This is used for more advanced scenarios where you need
 * direct access to the component.
 */
export async function evaluateWidget(
  code: string,
  services: Record<string, unknown> = {},
): Promise<React.ComponentType<{ services?: Record<string, unknown> }>> {
  // Store services for widget access
  (globalThis as Record<string, unknown>).__PATCHWORK_SERVICES__ = services;

  // Inject globals that the compiled code expects
  const __EXPORTS__: Record<string, unknown> = {};
  const __REACT__ = React;
  const __INK__ = await import('ink');

  // Execute the transformed code with injected globals
  const fn = new Function('__EXPORTS__', '__REACT__', '__INK__', code);
  fn(__EXPORTS__, __REACT__, __INK__);

  const Component =
    __EXPORTS__.default ||
    __EXPORTS__.Widget ||
    Object.values(__EXPORTS__).find(
      (v): v is React.ComponentType => typeof v === 'function',
    );

  if (!Component) {
    throw new Error('No default export or Widget component found');
  }

  return Component as React.ComponentType<{
    services?: Record<string, unknown>;
  }>;
}

/**
 * Render a component directly with Ink
 *
 * For cases where you already have an evaluated component.
 */
export function renderComponent(
  Component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown> = {},
  options: Omit<RunnerOptions, 'proxy' | 'inputs'> = {},
): RunnerInstance {
  const {
    stdout = process.stdout as WriteStream,
    stdin = process.stdin,
    exitOnCtrlC = true,
  } = options;
  const mountId = generateMountId();

  let currentProps = { ...props };
  const element = React.createElement(Component, currentProps);
  const instance = render(element, {
    stdout,
    stdin,
    exitOnCtrlC,
  });

  return {
    id: mountId,
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
    rerender(newProps: Record<string, unknown>) {
      currentProps = { ...currentProps, ...newProps };
      instance.rerender(React.createElement(Component, currentProps));
    },
    clear: () => instance.clear(),
  };
}
