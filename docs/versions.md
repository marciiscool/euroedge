# Pinned versions

Verified against npm / nodejs.org / Docker Hub on **2026-10-27**. Every dependency is pinned exactly (`save-exact=true`). Re-verify the current stable release before bumping (brief §2). Deviations from the brief are recorded in ADR-0011.

| Component                | Version                                                  | Notes                                         |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------- |
| Node.js                  | 24.22.1 (LTS "Krypton")                                  | `.nvmrc`, `engines`                           |
| pnpm                     | 12.15.0                                                  | `packageManager`                              |
| Turborepo                | 2.11.10                                                  |                                               |
| TypeScript               | 6.0.3                                                    | 7.0.x blocked by typescript-eslint peer range |
| @types/node              | 24.19.2                                                  | matches the Node major                        |
| PostgreSQL + TimescaleDB | `timescale/timescaledb:2.x-pg17` (tag pinned in compose) |                                               |
| Valkey                   | `valkey/valkey:8.x` (tag pinned in compose)              | ADR-0010                                      |
| Caddy                    | `caddy:2.x` (tag pinned in compose)                      | ADR-0012                                      |

Packages added in later tasks are listed in their `package.json`; this table only records toolchain and infrastructure pins.
