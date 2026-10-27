# ADR-0005 — shadcn on Base UI

- **Status:** Accepted (founder, 2026-10-27)

## Context

The brief prescribes shadcn/ui on Base UI. `@base-ui/react` is at 1.9 (stable 1.x line, verified 2026-10-27).

## Decision

- Use **Base UI** primitives through shadcn components, owned in `packages/ui` and re-exported to apps.
- **Fallback:** if a primitive is missing or defective, wrap Radix for that one component behind the same `packages/ui` API. Apps never import a primitive library directly.
- M0-09 records which primitive set the shadcn CLI uses as its default (see the CHANGELOG).

## Consequences

- One place to swap primitives later.
- Accessibility behaviour is covered by Playwright + axe in M7.

## Amendment (M0-09, 2026-10-27)

- **Default confirmed.** shadcn CLI 4.23 defaults to the `base-nova` style, i.e. Base UI.
- **Registry blocked.** The registry (`ui.shadcn.com`) is not reachable from the build environment's network policy. Components are therefore authored by hand, following the `base-nova` conventions: `cva` variants, `data-slot`, and `cn()` from `@euroedge/ui/lib/utils`. `components.json` exists in `packages/ui` and `apps/web`, so `shadcn add` works wherever the registry is reachable.

## Founder review (M0, 2026-10-27)

Hand-written components are accepted. Once the shadcn registry is reachable, run `shadcn add` for each hand-written component, diff the result against ours, and reconcile. This is tracked as a recurring check in the milestone reports.
