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
