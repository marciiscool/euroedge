# Contributing

## Workflow

- **One task per branch and per PR.** Each task takes ≤ 1 day and ≤ ~400 LOC of diff, excluding lockfiles and generated files. Task IDs come from `PLAN.md` §5 (e.g. `M1-07`).
- Branch names: `<type>/<task-id>-<slug>`, e.g. `feat/m1-07-event-envelope`.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`, `refactor:`), checked by commitlint locally and in CI.
- Tests come before or with the code. A task is never done while anything is red: `pnpm lint typecheck test build` and `pnpm check:guards`.
- Keep `README.md` and `CHANGELOG.md` current in the same PR.

## Review gate (founder rule)

Any ADR or PR that changes the maths of brief §6–§8 needs the **founder's explicit review before merge**. That covers FV, mark, index, funding, margin, liquidation, fees, ledger or smart contracts.

- Label the PR `needs-founder-review` and tick the box in the PR template.
- Golden vectors and invariant tests must be updated in the same PR.

## Money & determinism

- No floats for money, prices or quantities. Use `@euroedge/fixed` (branded bigints, explicit rounding).
- Engine-core code (`packages/{fixed,ledger,risk-core}`, `apps/engine/src/core`) must not read the clock, use randomness, timers or `Math`. ESLint enforces this.
- Floats (`exp`/`ln`) are allowed only inside `packages/fv-core`, and are quantized to integer ticks at its boundary.

## Ambiguity

If the brief is ambiguous or looks wrong, write an ADR (options + recommendation) in `docs/adr/` and ask. Never deviate silently.

## Dependencies

- Pin exact versions. Shared versions go in the `catalog:` in `pnpm-workspace.yaml`.
- pnpm refuses versions younger than 24 h (`minimumReleaseAge`). Don't override it.
- Install scripts are denied by default (`allowBuilds`). Allow one only with a reason in the PR.
