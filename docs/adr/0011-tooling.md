# ADR-0011 — Tooling choices & deviations from the brief

- **Status:** Accepted (founder, 2026-10-27); amendments recorded at M0 start.

## Decision

| Area | Choice | Note |
|---|---|---|
| Lint | **ESLint 10** flat config + typescript-eslint 8; Prettier 3 | Brief said 9; 10 is current stable. Fallback to 9 if a plugin lags. |
| TypeScript | **6.0.3** | 7.0 (the native port) is latest, but typescript-eslint peers `typescript <6.1`. Revisit when it supports 7. |
| Runtime | **Node 24 LTS**, native type stripping | Workspace packages export `./src/index.ts`; services run `node src/main.ts` with no build step. `erasableSyntaxOnly` is enforced: no enums, namespaces or parameter properties. Relative imports use the `.ts` extension. |
| Package manager | pnpm 12 via `packageManager` | |
| DB access | **Kysely** (typed SQL) + **plain-SQL migrations** in `packages/db` | No ORM; TimescaleDB DDL is SQL. |
| Extra packages | `packages/db`, `packages/service-kit` (pino, Fastify health, graceful shutdown, Valkey client) | Not in the brief's layout; added to keep server deps out of `packages/shared` (which the web app also imports). |
| Determinism lint | In `packages/{fixed,ledger,risk-core}` and `apps/engine/src/core`: ban `Date`, `Math`, timers, `performance`, `process`, `Number.parseFloat`, and non-integer numeric literals | Enforces ADR-0001. |
| Tests | Vitest 5 projects, fast-check 4, Playwright | |
| Git hooks | lefthook (Prettier on staged files, commitlint) | |
