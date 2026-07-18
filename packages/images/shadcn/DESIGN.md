# Design reference — shadcn image

Extended guidance for building more complex widgets with this runtime. This
doc is lazy-loaded on demand (like a skill) — it is not part of the base
prompt.

## Layout

- Compose with `flex`/`grid`; avoid absolute positioning except overlays.
- Cards (`bg-card border rounded-lg p-4`) are the default surface for grouped
  content; keep one level of nesting.
- Constrain widget width with `max-w-*` + `mx-auto` when content is narrow.

## Components

- Forms: `Input`, `Label`, `Select`, `Button` from `@/components/ui/*`;
  validate inline, disable the submit button while pending.
- Data: `Table` for tabular data; badges (`Badge`) for status; skeletons for
  loading states.
- Feedback: empty states get an icon + one-line explanation; errors get a
  retry affordance.

## Theme tokens

| Intent | Token |
| --- | --- |
| Surface | `bg-background` / `bg-card` |
| Text | `text-foreground` / `text-muted-foreground` |
| Accent | `bg-primary text-primary-foreground` |
| Destructive | `bg-destructive text-destructive-foreground` |
| Border | `border` (uses `--border`) |

Never hard-code hex colors or `bg-white`/`text-black`.
