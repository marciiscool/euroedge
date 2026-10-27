# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries reference `PLAN.md` task IDs.

## [Unreleased]

### M1 — Thin vertical slice (2026-10-27, on `integration/m1`)

#### Added

- Shared schemas and config (M1-01), interim calendar with A/B/C/D windows (M1-02), deterministic simulated world (M1-03), ingest to Timescale/Valkey (M1-04).
- fv-core v0 (M1-05) and fv-service (M1-06): Tradegate + ADR signals, band, Window A median-of-three index, step-capped and band-clamped mark.
- Engine: event model and hash chain (M1-07), Postgres event store (M1-08), sequencer + bootstrap + publisher (M1-09), ledger (M1-10), risk-core (M1-11), deterministic core with orders, liquidation and invariants (M1-12).
- Invariant property harness (M1-13) and a full simulated trading day replay test (M1-21).
- ExecutionAdapter + SimAdapter (M1-14), API v0 with dev login, orders and WebSocket (M1-15), bare trade terminal (M1-16/17).
- Playwright e2e + axe accessibility in CI (M1-18, M1-20), screenshots and demo script (M1-22), report `docs/milestones/m1.md` (M1-19).

#### Fixed

- House equity now includes the house cost basis when flat in lots (Invariant 7).
- Language switcher accessible name (WCAG 2.5.3); WebSocket account channel bound strictly to the session.
- German order copy; chart number locale; web lint runs `next typegen` first on fresh checkouts.

### M0 review decisions (2026-10-27)

#### Changed

- `PLAN.md` v2.1 and ADRs 0005/0008/0011/0013/0016 record the founder's M0 review:
  - Invariant 7 in full form, plus Invariants 8 (house equity ≥ 0) and 9 (insurance ≥ 0);
  - funding cap on the total rate;
  - Tradegate-stale escalation (> 5 min → reduce-only, released after 2 min fresh);
  - CB7 hysteresis (20 % trigger / 30 % release);
  - axe-core in CI from M1, and a per-milestone re-check of jsx-a11y ESLint 10 support;
  - shadcn reconciliation once the registry is reachable;
  - new M1 tasks M1-20…22.

### Research (2026-10-27)

#### Added

- `.claude/skills/`: three reviewed, pinned, MIT-licensed agent skills (`web-interface-guidelines`, `make-interfaces-feel-better`, `accessibility`) with provenance in `.claude/skills/README.md`.
- `CLAUDE.md`: precedence rules and skill overrides for coding agents.
- `docs/research/skills-review.md`: every candidate from skill-issue.in and why it was installed, parked or rejected.
- `docs/research/ui/design-notes.md`: interim UI principles and the WCAG 2.2 requirements they surfaced (2.1.4 single-key shortcuts must be switchable off; 2.4.11; 2.5.7; 2.5.8).

### M0 — Scaffold (2026-10-27)

#### Added

- `PLAN.md` v2 with the founder's decisions, and ADRs 0001–0017 (`docs/adr/`).
- **M0-01** pnpm 12 / Turborepo 2.11 monorepo, strict TypeScript 6.0, Node 24.22 pin; `docs/versions.md`.
- **M0-02** ESLint 10 (type-aware) + Prettier + commitlint + lefthook. Determinism lint rules for engine-core code.
- **M0-03** Vitest 5 workspace config; fast-check defaults (`FC_NUM_RUNS`, `FC_SEED`).
- **M0-04** `compose.yaml` (TimescaleDB 2.31/pg17, Valkey 8.1, Caddy 2.11 single origin on :8080). `packages/db`: Kysely client (int8 → bigint) and a checksummed plain-SQL migration runner.
- **M0-05** `packages/shared`: zod-4 env/YAML config loader, data-tier feature gates, `.env.example`. Runtime guard refusing `DEV_LOGIN` outside `DATA_TIER=sim` in local/ci.
- **M0-06** `packages/fixed`: branded bigint units, five explicit rounding modes, exact decimals.
- **M0-07** `packages/fixed`: market units with integer tick value (100 µUSDC stocks, 10 µUSDC baskets), exact PnL/notional, fees rounding up.
- **M0-08** `packages/service-kit` (pino, `/health`, `/ready`, graceful shutdown) and skeletons for engine, fv-service, ingest, api, relayer, indexer, bots and the backtest CLI.
- **M0-09** `apps/web`: Next.js 16.4 with PPR shell, next-intl en/de, dark/light themes, testnet banner. `packages/ui`: design tokens with colour-blind-safe up/down palettes, Button on Base UI. WCAG AA contrast tests.
- **M0-10** GitHub Actions CI (guards, checks with service containers, audit, contracts placeholder); `pnpm check:guards`.
- **M0-11** README, CONTRIBUTING (founder review gate), PR template, this changelog.

#### Fixed

- `apps/web` typecheck now runs `next typegen` first. Before this, it failed on a fresh clone; found by verifying M0 from a clean clone.

#### Notes

- **shadcn:** the CLI's default preset is `base-nova` (Base UI), which confirms ADR-0005. The registry host `ui.shadcn.com` is blocked by this environment's network policy, so the first components were written by hand following shadcn conventions. `components.json` is in place for `shadcn add` later.
- **Release-age policy:** typescript-eslint is pinned to 8.72.0 because 8.72.1 is younger than pnpm's 24 h `minimumReleaseAge`.
