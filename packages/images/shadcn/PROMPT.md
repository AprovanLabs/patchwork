### Runtime: `@aprovan/patchwork-image-shadcn`

React 18 + shadcn/ui + Tailwind CSS, running sandboxed in the browser.

**Imports you may use**

- `react` — hooks and component APIs.
- shadcn/ui components via `@/components/ui/<name>`, e.g. `import { Button } from '@/components/ui/button'`; `cn` from `@/lib/utils`.
- Nothing else unless the user asks; prefer hand-rolled markup over extra packages.

**Styling**

- Tailwind utility classes only. Use theme tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border`, `bg-primary`, …) rather than hard-coded colors like `bg-white`, so widgets render correctly in light and dark mode.
- Spacing, hierarchy, and rounded corners over decoration; no gaudy gradients.

**Constraints**

- No server access from imports — server calls go through the injected SDK namespaces, and `fetch` only against public CORS-enabled APIs, with failure states handled.
- A deeper design reference is available as the `design` doc of this image.
