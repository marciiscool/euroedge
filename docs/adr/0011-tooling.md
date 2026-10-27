# ADR-0011 — Tooling choices & deviations from the brief

- **Status:** Accepted (founder, 2026-10-27); amendments recorded at M0 start.

## Decision

| Area             | Choice                                                                                                                                                                         | Note                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint             | **ESLint 10** flat config + typescript-eslint 8; Prettier 3                                                                                                                    | Brief said 9; 10 is current stable. Fallback to 9 if a plugin lags.                                                                                                                                                       |
| TypeScript       | **6.0.3**                                                                                                                                                                      | 7.0 (the native port) is latest, but typescript-eslint peers `typescript <6.1`. Revisit when it supports 7.                                                                                                               |
| Runtime          | **Node 24 LTS**, native type stripping                                                                                                                                         | Workspace packages export `./src/index.ts`; services run `node src/main.ts` with no build step. `erasableSyntaxOnly` is enforced: no enums, namespaces or parameter properties. Relative imports use the `.ts` extension. |
| Package manager  | pnpm 12 via `packageManager`                                                                                                                                                   |                                                                                                                                                                                                                           |
| DB access        | **Kysely** (typed SQL) + **plain-SQL migrations** in `packages/db`                                                                                                             | No ORM; TimescaleDB DDL is SQL.                                                                                                                                                                                           |
| Extra packages   | `packages/db`, `packages/service-kit` (pino, Fastify health, graceful shutdown, Valkey client)                                                                                 | Not in the brief's layout; added to keep server deps out of `packages/shared` (which the web app also imports).                                                                                                           |
| Determinism lint | In `packages/{fixed,ledger,risk-core}` and `apps/engine/src/core`: ban `Date`, `Math`, timers, `performance`, `process`, `Number.parseFloat`, and non-integer numeric literals | Enforces ADR-0001.                                                                                                                                                                                                        |
| Tests            | Vitest 5 projects, fast-check 4, Playwright                                                                                                                                    |                                                                                                                                                                                                                           |
| Git hooks        | lefthook (Prettier on staged files, commitlint)                                                                                                                                |                                                                                                                                                                                                                           |

## Amendments (M0, 2026-10-27)

**Web linting**

- `apps/web` uses `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` on top of the root config.
- `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y` (and therefore `eslint-config-next`) do not yet declare ESLint 10 support.
- Accessibility is enforced by axe-core in Playwright (M7-27).
- **Fallback:** if static a11y linting proves necessary before those plugins support ESLint 10, drop to ESLint 9 (founder-approved fallback).

**Supply-chain policy**

- pnpm 12's `minimumReleaseAge` (24 h) is kept and set explicitly.
- Install scripts are denied by default (`allowBuilds`). Currently denied: lefthook, @swc/core, @parcel/watcher; none needs its script.
- typescript-eslint is pinned to 8.72.0 because 8.72.1 was less than 24 h old.

**Other**

- `no-unsafe-unary-minus` is off: it is a false positive for branded bigints.
- `next-env.d.ts` is generated and gitignored.

## Founder review (M0, 2026-10-27)

- TypeScript 6.0.3 accepted; revisit when typescript-eslint supports TS 7.
- **Stay on ESLint 10.** Accessibility moves forward: `@axe-core/playwright` from M1, running on every existing page in CI and failing on serious/critical violations.
- **Each milestone report** re-checks ESLint 10 support in `eslint-plugin-jsx-a11y` (and react/import). `jsx-a11y` is re-enabled as soon as it supports ESLint 10.
- The pnpm 24 h `minimumReleaseAge` rule is kept.
