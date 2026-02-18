/**
 * @aprovan/patchwork-image-shadcn
 *
 * ShadCN/ui image for browser widgets with Tailwind CSS and Radix UI components.
 */

// Setup and cleanup
export {
  setup,
  cleanup,
  DEFAULT_CSS_VARIABLES,
  DARK_CSS_VARIABLES,
  type SetupOptions,
} from './setup.js';

// HTML generation (for browser runtime)
export {
  generateHtml,
  transformWidgetCode,
  getDefaultImportMap,
  getFrameworkDependencies,
  type HtmlOptions,
  type ImportMapEntry,
} from './html.js';

// Re-export commonly used utilities
export { clsx } from 'clsx';
export { twMerge } from 'tailwind-merge';
export { cva, type VariantProps } from 'class-variance-authority';

// Utility function combining clsx and twMerge (shadcn convention)
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
