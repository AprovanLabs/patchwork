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
} from "./setup";

export { clsx } from "clsx";
export { twMerge } from "tailwind-merge";
export { cva, type VariantProps } from "class-variance-authority";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
