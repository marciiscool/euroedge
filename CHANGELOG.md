# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries reference `PLAN.md` task IDs.

## [Unreleased]

### M3 — Full fv-core (in progress, on `integration/m3`)

#### Added

- Anchor manager (M3-01):
  - GBX and DKK closes are converted to EUR at `t_C`.
  - EURDKK falls back to the 7.46038 peg without a feed and raises an alert beyond 0.5 %.
  - NOVO and SHEL are enabled.
- Dividends per line (M3-02): the anchor moves on the local ex-date, and the ADR signal uses its own ex-date without double counting.
- ADR basis `b_A` as an EWMA of close-to-open residuals, with a configurable half-life (M3-03).

### M2 — Data layer (complete, on `integration/m2`)

#### Added

- Six more stock perps (founder request): Allianz, Airbus, Deutsche Telekom, Infineon, Schneider Electric and L'Oréal. They use the same window leverage as the other stocks (5x in Window A). `GET /api/markets` feeds the terminal's market list, so new tickers need only a `markets.yaml` entry.

- Curated venue calendars 2026–2028 in `config/calendars/` for XETR, TGAT, LSX, XAMS, XPAR, XCSE, XLON, XNYS, XNAS, USON, XEUR and FX. They cover holidays, half-days, auction phases and random-end ranges, with a schema and a generated browser-safe module (M2-01…04).
- Venue-state resolver (`venueState`, `nextVenueTransition`) and a holiday-aware window resolver (M2-05/06). Tests cover a cross-check against an `exchange_calendars` 4.13.2 fixture, holidays, half-days, the US overnight session and a 120-day coverage guard (M2-07).
- `markets.yaml` lists all ten markets (M2-17):
  - Five EUR stock perps are enabled.
  - NOVO and SHEL follow the ADR-0017 window and price-source rules. They stay disabled until EUR conversion of the anchor lands in M3.
  - RHM is a late launch.
  - EE-Blue 20 (20 constituents, 10 % cap) and EE-Semis (5 constituents, 35 % cap) are draft baskets that need founder sign-off.
- Underlying helpers in `@euroedge/shared`: `allUnderlyings`, `basketConstituents`, `underlyingLines`.
- An `OTCM` calendar for OTC ADRs (SIEGY, LVMUY).
- The terminal switches between the five enabled markets (`?market=`).
- Sim world v1 (M2-09…12):
  - market and sector factors, and every basket constituent;
  - EURUSD, EURGBP, and EURDKK pegged at 7.46038;
  - DKK/GBX primary lines;
  - local and ADR dividends on separate ex-dates;
  - opening/closing auctions with a random end;
  - US pre-market, after-hours and overnight quotes;
  - seeded and scheduled faults (bad print, stale feed, halt);
  - `config/sim.yaml`.
- Tick CSV format (`docs/data-format.md`), a committed two-week sample in `data/sample/`, and a `ReplayProvider` with a 1–1000× virtual clock (M2-13/14).
- A key-gated `PythProvider` (M2-15). It refuses to start without `PYTH_API_KEY` and is tested against a recorded-shape fixture; the wire format is unverified until the key arrives.
- Stub providers for Tradegate, Xetra delayed and Eurex, with licence/attribution metadata and the source list per tier (M2-16).
- `FeedMonitor`: halt detection from feed silence and provider health (M2-08).
- Ingest v1 (M2-18):
  - `DATA_TIER=replay` streams a tick file at `REPLAY_SPEED`;
  - `live-min` refuses to start until the Tradegate vendor and Pyth key exist;
  - exact duplicate ticks are dropped.

  Ticks keep their source currency; GBX/100 and FX conversion happen in fv-core (M3).

- `markets.yaml` lists all ten markets (M2-17):
  - Five EUR stock perps are enabled.
  - NOVO and SHEL follow ADR-0017 but stay disabled until EUR conversion of the anchor lands in M3.
  - RHM is a late launch.
  - EE-Blue 20 and EE-Semis are draft baskets that need founder sign-off.
- An `OTCM` calendar for OTC ADRs (SIEGY, LVMUY).

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
