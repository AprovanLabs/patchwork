/**
 * @aprovan/patchwork-image-shadcn
 *
 * Setup function for the ShadCN/ui image.
 * Uses Tailwind Play CDN for runtime CSS generation.
 */

export interface SetupOptions {
  /** Enable dark mode (default: false - respects system preference) */
  darkMode?: boolean | 'system';
  /** Inject CSS runtime (default: true) */
  cssRuntime?: boolean;
  /** Custom CSS variable overrides */
  cssVariables?: Record<string, string>;
}

export const DEFAULT_CSS_VARIABLES = {
  '--background': '0 0% 100%',
  '--foreground': '222.2 84% 4.9%',
  '--card': '0 0% 100%',
  '--card-foreground': '222.2 84% 4.9%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '222.2 84% 4.9%',
  '--primary': '222.2 47.4% 11.2%',
  '--primary-foreground': '210 40% 98%',
  '--secondary': '210 40% 96.1%',
  '--secondary-foreground': '222.2 47.4% 11.2%',
  '--muted': '210 40% 96.1%',
  '--muted-foreground': '215.4 16.3% 46.9%',
  '--accent': '210 40% 96.1%',
  '--accent-foreground': '222.2 47.4% 11.2%',
  '--destructive': '0 84.2% 60.2%',
  '--destructive-foreground': '210 40% 98%',
  '--border': '214.3 31.8% 91.4%',
  '--input': '214.3 31.8% 91.4%',
  '--ring': '222.2 84% 4.9%',
  '--radius': '0.5rem',
};

export const DARK_CSS_VARIABLES = {
  '--background': '222.2 84% 4.9%',
  '--foreground': '210 40% 98%',
  '--card': '222.2 84% 4.9%',
  '--card-foreground': '210 40% 98%',
  '--popover': '222.2 84% 4.9%',
  '--popover-foreground': '210 40% 98%',
  '--primary': '210 40% 98%',
  '--primary-foreground': '222.2 47.4% 11.2%',
  '--secondary': '217.2 32.6% 17.5%',
  '--secondary-foreground': '210 40% 98%',
  '--muted': '217.2 32.6% 17.5%',
  '--muted-foreground': '215 20.2% 65.1%',
  '--accent': '217.2 32.6% 17.5%',
  '--accent-foreground': '210 40% 98%',
  '--destructive': '0 62.8% 30.6%',
  '--destructive-foreground': '210 40% 98%',
  '--border': '217.2 32.6% 17.5%',
  '--input': '217.2 32.6% 17.5%',
  '--ring': '212.7 26.8% 83.9%',
  '--radius': '0.5rem',
};

// Track CSS runtime state
let tailwindLoadPromise: Promise<void> | null = null;
let themeStyleElement: HTMLStyleElement | null = null;
const containerObservers: Map<HTMLElement, MutationObserver> = new Map();

// Window type augmentation for Tailwind Play CDN
declare global {
  interface Window {
    tailwind?: {
      config?: Record<string, unknown>;
    };
  }
}

/**
 * Setup the ShadCN/ui image runtime environment
 *
 * Injects Tailwind Play CDN and theme CSS variables.
 * Sets up a MutationObserver to trigger CSS regeneration when content changes.
 *
 * @param root - Root element where the widget will be mounted
 * @param options - Optional configuration
 */
export async function setup(
  root: HTMLElement,
  options: SetupOptions = {},
): Promise<void> {
  const { darkMode = 'system', cssRuntime = true, cssVariables = {} } = options;

  // Inject Tailwind Play CDN and wait for it to load
  if (cssRuntime) {
    await injectTailwindPlayCdn();
  }

  // Determine if dark mode
  let isDark = false;
  if (darkMode === true) {
    isDark = true;
  } else if (darkMode === 'system') {
    isDark =
      window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  // Create or update theme style element
  if (!themeStyleElement) {
    themeStyleElement = document.createElement('style');
    themeStyleElement.id = 'patchwork-image-shadcn-theme';
    document.head.appendChild(themeStyleElement);
  }

  // Build CSS variables
  const baseVars = isDark ? DARK_CSS_VARIABLES : DEFAULT_CSS_VARIABLES;
  const mergedVars = { ...baseVars, ...cssVariables };
  const cssVarsString = Object.entries(mergedVars)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n    ');

  themeStyleElement.textContent = `
    /* Patchwork ShadCN Theme */
    :root {
      ${cssVarsString}
    }

    .patchwork-widget {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.5;
      color: hsl(var(--foreground));
      background-color: hsl(var(--background));
    }

    .patchwork-widget *, .patchwork-widget *::before, .patchwork-widget *::after {
      box-sizing: border-box;
      border-color: hsl(var(--border));
    }
  `;

  // Mark root as patchwork widget container
  root.classList.add('patchwork-widget');

  // Set dark mode class if needed
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Set up MutationObserver to trigger Tailwind re-compile on content changes
  if (cssRuntime && !containerObservers.has(root)) {
    const observer = new MutationObserver(() => {
      // Trigger Tailwind to re-scan by dispatching a custom event
      // The Play CDN listens for this internally
      requestAnimationFrame(() => {
        // Force Tailwind to re-process by triggering a mutation
        const tempNode = document.createTextNode('');
        document.body.appendChild(tempNode);
        document.body.removeChild(tempNode);
      });
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    containerObservers.set(root, observer);
  }
}

/**
 * Inject Tailwind Play CDN script
 *
 * The Play CDN automatically observes the DOM and generates CSS
 * for any Tailwind classes it finds.
 *
 * Returns a promise that resolves when Tailwind is fully loaded.
 */
function injectTailwindPlayCdn(): Promise<void> {
  // Return existing promise if already loading/loaded
  if (tailwindLoadPromise) {
    return tailwindLoadPromise;
  }

  // Check if already injected
  if (document.getElementById('patchwork-tailwind-cdn')) {
    return Promise.resolve();
  }

  tailwindLoadPromise = new Promise((resolve, reject) => {
    // First, set up the config object BEFORE loading Tailwind
    // Tailwind Play CDN reads window.tailwind.config on load
    window.tailwind = {
      config: {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              border: 'hsl(var(--border))',
              input: 'hsl(var(--input))',
              ring: 'hsl(var(--ring))',
              background: 'hsl(var(--background))',
              foreground: 'hsl(var(--foreground))',
              primary: {
                DEFAULT: 'hsl(var(--primary))',
                foreground: 'hsl(var(--primary-foreground))',
              },
              secondary: {
                DEFAULT: 'hsl(var(--secondary))',
                foreground: 'hsl(var(--secondary-foreground))',
              },
              destructive: {
                DEFAULT: 'hsl(var(--destructive))',
                foreground: 'hsl(var(--destructive-foreground))',
              },
              muted: {
                DEFAULT: 'hsl(var(--muted))',
                foreground: 'hsl(var(--muted-foreground))',
              },
              accent: {
                DEFAULT: 'hsl(var(--accent))',
                foreground: 'hsl(var(--accent-foreground))',
              },
              popover: {
                DEFAULT: 'hsl(var(--popover))',
                foreground: 'hsl(var(--popover-foreground))',
              },
              card: {
                DEFAULT: 'hsl(var(--card))',
                foreground: 'hsl(var(--card-foreground))',
              },
            },
            borderRadius: {
              lg: 'var(--radius)',
              md: 'calc(var(--radius) - 2px)',
              sm: 'calc(var(--radius) - 4px)',
            },
          },
        },
      },
    };

    // Load Tailwind Play CDN
    const script = document.createElement('script');
    script.id = 'patchwork-tailwind-cdn';
    script.src = 'https://cdn.tailwindcss.com';

    // Wait for script to load before resolving
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error('Failed to load Tailwind Play CDN'));
    };

    document.head.appendChild(script);
  });

  return tailwindLoadPromise;
}

/**
 * Cleanup any global resources added by setup
 */
export function cleanup(): void {
  if (themeStyleElement) {
    themeStyleElement.remove();
    themeStyleElement = null;
  }

  const tailwindScript = document.getElementById('patchwork-tailwind-cdn');
  if (tailwindScript) {
    tailwindScript.remove();
    tailwindLoadPromise = null;
  }

  // Clean up the tailwind config from window
  if (window.tailwind) {
    delete window.tailwind;
  }

  // Clean up observers
  containerObservers.forEach((observer) => observer.disconnect());
  containerObservers.clear();
}
